import { useState, useCallback, useRef, useEffect } from 'react'
import { useWebRTCPeer } from '../components/WebRTCProvider'
import { z } from 'zod'
import { ChunkMessage, decodeMessage, Message, MessageType } from '../messages'
import { DataConnection } from 'peerjs'
import {
  streamDownloadSingleFile,
  streamDownloadMultipleFiles,
} from '../utils/download'
import {
  PREVIEW_MAX_BYTES,
  previewBlockedReason,
  sniffImageMimeType,
} from '../utils/preview'
import {
  browserName,
  browserVersion,
  osName,
  osVersion,
  mobileVendor,
  mobileModel,
} from 'react-device-detect'
import { setRotating } from './useRotatingSpinner'
const cleanErrorMessage = (errorMessage: string): string =>
  errorMessage.startsWith('Could not connect to peer')
    ? 'Could not connect to the uploader. Did they close their browser?'
    : errorMessage

const getZipFilename = (): string => `filepizza-download-${Date.now()}.zip`

export type PreviewResult = { blob: Blob; mimeType: string }

export function useDownloader(uploaderPeerID: string): {
  filesInfo: Array<{ fileName: string; size: number; type: string }> | null
  isConnected: boolean
  isPasswordRequired: boolean
  isDownloading: boolean
  isDone: boolean
  errorMessage: string | null
  submitPassword: (password: string) => void
  startDownload: () => void
  stopDownload: () => void
  startPreview: (fileName: string) => Promise<PreviewResult>
  cancelPreview: () => void
  isPreviewing: boolean
  previewBytes: number
  totalSize: number
  bytesDownloaded: number
} {
  const { peer } = useWebRTCPeer()
  const [dataConnection, setDataConnection] = useState<DataConnection | null>(
    null,
  )
  const [filesInfo, setFilesInfo] = useState<Array<{
    fileName: string
    size: number
    type: string
  }> | null>(null)
  const processChunk = useRef<
    ((message: z.infer<typeof ChunkMessage>) => void) | null
  >(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isPasswordRequired, setIsPasswordRequired] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isDone, setDone] = useState(false)
  const [bytesDownloaded, setBytesDownloaded] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [previewBytes, setPreviewBytes] = useState(0)
  const abortPreviewRef = useRef<((message: string) => void) | null>(null)

  useEffect(() => {
    if (!peer) return
    console.log('[Downloader] connecting to uploader', uploaderPeerID)
    const conn = peer.connect(uploaderPeerID, { reliable: true })
    setDataConnection(conn)

    const handleOpen = () => {
      console.log('[Downloader] connection opened')
      setIsConnected(true)
      conn.send({
        type: MessageType.RequestInfo,
        browserName,
        browserVersion,
        osName,
        osVersion,
        mobileVendor,
        mobileModel,
      } as z.infer<typeof Message>)
    }

    const handleData = (data: unknown) => {
      try {
        const message = decodeMessage(data)
        console.log('[Downloader] received message', message.type)
        switch (message.type) {
          case MessageType.PasswordRequired:
            setIsPasswordRequired(true)
            if (message.errorMessage) setErrorMessage(message.errorMessage)
            break
          case MessageType.Info:
            setFilesInfo(message.files)
            setIsPasswordRequired(false)
            break
          case MessageType.Chunk:
            processChunk.current?.(message)
            setRotating(true)
            break
          case MessageType.Error:
            console.error('[Downloader] received error message:', message.error)
            setErrorMessage(message.error)
            conn.close()
            break
          case MessageType.Report:
            console.log('[Downloader] received report message, redirecting')
            window.location.href = '/reported'
            break
        }
      } catch (err) {
        console.error('[Downloader] error handling message:', err)
      }
    }

    const handleClose = () => {
      console.log('[Downloader] connection closed')
      abortPreviewRef.current?.(
        'The uploader disconnected before the preview finished.',
      )
      setRotating(false)
      setDataConnection(null)
      setIsConnected(false)
      setIsDownloading(false)
    }

    const handleError = (err: Error) => {
      console.error('[Downloader] connection error:', err)
      abortPreviewRef.current?.(
        'The connection to the uploader failed before the preview finished.',
      )
      setErrorMessage(cleanErrorMessage(err.message))
      if (conn.open) conn.close()
      else handleClose()
    }

    conn.on('open', handleOpen)
    conn.on('data', handleData)
    conn.on('error', handleError)
    conn.on('close', handleClose)
    peer.on('error', handleError)

    return () => {
      console.log('[Downloader] cleaning up connection')
      if (conn.open) {
        conn.close()
      } else {
        conn.once('open', () => {
          conn.close()
        })
      }

      conn.off('open', handleOpen)
      conn.off('data', handleData)
      conn.off('error', handleError)
      conn.off('close', handleClose)
      peer.off('error', handleError)
    }
  }, [peer])

  const submitPassword = useCallback(
    (pass: string) => {
      if (!dataConnection) return
      console.log('[Downloader] submitting password')
      dataConnection.send({
        type: MessageType.UsePassword,
        password: pass,
      } as z.infer<typeof Message>)
    },
    [dataConnection],
  )

  const startDownload = useCallback(() => {
    // The uploader only services one transfer at a time, so never overlap a
    // download with an in-flight preview.
    if (!filesInfo || !dataConnection || isPreviewing) return
    console.log('[Downloader] starting download')
    setIsDownloading(true)

    const fileStreamByPath: Record<
      string,
      {
        stream: ReadableStream<Uint8Array>
        enqueue: (chunk: Uint8Array) => void
        close: () => void
      }
    > = {}
    const fileStreams = filesInfo.map((info) => {
      let enqueue: ((chunk: Uint8Array) => void) | null = null
      let close: (() => void) | null = null
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          enqueue = (chunk: Uint8Array) => ctrl.enqueue(chunk)
          close = () => ctrl.close()
        },
      })
      if (!enqueue || !close)
        throw new Error('Failed to initialize stream controllers')
      fileStreamByPath[info.fileName] = { stream, enqueue, close }
      return stream
    })

    let nextFileIndex = 0
    const startNextFileOrFinish = () => {
      if (nextFileIndex >= filesInfo.length) return
      console.log(
        '[Downloader] starting next file:',
        filesInfo[nextFileIndex].fileName,
      )
      dataConnection.send({
        type: MessageType.Start,
        fileName: filesInfo[nextFileIndex].fileName,
        offset: 0,
      } as z.infer<typeof Message>)
      nextFileIndex++
    }

    let chunkCountByFile: Record<string, number> = {}
    processChunk.current = (message: z.infer<typeof ChunkMessage>) => {
      const fileStream = fileStreamByPath[message.fileName]
      if (!fileStream) {
        console.error('[Downloader] no stream found for', message.fileName)
        return
      }

      // Track chunks for e2e testing
      if (!chunkCountByFile[message.fileName]) {
        chunkCountByFile[message.fileName] = 0
      }
      chunkCountByFile[message.fileName]++
      console.log(
        `[Downloader] received chunk ${chunkCountByFile[message.fileName]} for ${message.fileName} (${message.offset}-${message.offset + (message.bytes as ArrayBuffer).byteLength}) final=${message.final}`,
      )

      const chunkSize = (message.bytes as ArrayBuffer).byteLength
      setBytesDownloaded((bd) => bd + chunkSize)
      fileStream.enqueue(new Uint8Array(message.bytes as ArrayBuffer))

      // Send acknowledgment to uploader
      const ackMessage: Message = {
        type: MessageType.ChunkAck,
        fileName: message.fileName,
        offset: message.offset,
        bytesReceived: chunkSize,
      }
      dataConnection.send(ackMessage)
      console.log(
        `[Downloader] sent ack for chunk ${chunkCountByFile[message.fileName]} (${message.offset}, ${chunkSize} bytes)`,
      )

      if (message.final) {
        console.log(
          `[Downloader] finished receiving ${message.fileName} after ${chunkCountByFile[message.fileName]} chunks`,
        )
        fileStream.close()
        startNextFileOrFinish()
      }
    }

    const downloads = filesInfo.map((info, i) => ({
      name: info.fileName.replace(/^\//, ''),
      size: info.size,
      stream: () => fileStreams[i],
    }))

    const downloadPromise =
      downloads.length > 1
        ? streamDownloadMultipleFiles(downloads, getZipFilename())
        : streamDownloadSingleFile(downloads[0], downloads[0].name)

    downloadPromise
      .then(() => {
        console.log('[Downloader] all files downloaded')
        dataConnection.send({ type: MessageType.Done } as z.infer<
          typeof Message
        >)
        setDone(true)
      })
      .catch((err) => console.error('[Downloader] download error:', err))

    startNextFileOrFinish()
  }, [dataConnection, filesInfo, isPreviewing])

  const startPreview = useCallback(
    async (fileName: string): Promise<PreviewResult> => {
      if (!dataConnection) {
        throw new Error('Not connected to the uploader.')
      }
      if (isDownloading) {
        throw new Error('A download is already in progress.')
      }
      if (isPreviewing) {
        throw new Error('A preview is already in progress.')
      }
      if (!filesInfo) {
        throw new Error('No file information received from the uploader yet.')
      }

      const info = filesInfo.find((f) => f.fileName === fileName)
      if (!info) {
        throw new Error(`Unknown file: ${fileName}`)
      }

      const blockedReason = previewBlockedReason(info)
      if (blockedReason) {
        throw new Error(blockedReason)
      }

      setIsPreviewing(true)
      setPreviewBytes(0)

      return new Promise<PreviewResult>((resolve, reject) => {
        const chunks: Uint8Array[] = []
        let received = 0
        let mimeType = ''
        let settled = false

        const settle = (finish: () => void): void => {
          if (settled) return
          settled = true
          processChunk.current = null
          abortPreviewRef.current = null
          setIsPreviewing(false)
          setPreviewBytes(0)
          finish()
        }

        const abort = (message: string): void => {
          try {
            if (dataConnection.open) {
              dataConnection.send({
                type: MessageType.Pause,
              } as z.infer<typeof Message>)
            }
          } catch (err) {
            console.error('[Downloader] failed to send Pause:', err)
          }
          settle(() => reject(new Error(message)))
        }

        abortPreviewRef.current = abort

        processChunk.current = (message: z.infer<typeof ChunkMessage>) => {
          if (message.fileName !== fileName) return

          const bytes = new Uint8Array(message.bytes as ArrayBuffer)

          // Sniff the first chunk so an unsupported file is rejected before we
          // pull the whole thing down.
          if (mimeType === '' && bytes.byteLength > 0) {
            const sniffed = sniffImageMimeType(bytes)
            if (!sniffed) {
              abort('This file type cannot be previewed.')
              return
            }
            mimeType = sniffed
          }

          received += bytes.byteLength
          if (received > PREVIEW_MAX_BYTES) {
            abort('This file is too large to preview.')
            return
          }
          chunks.push(bytes)
          setPreviewBytes(received)

          dataConnection.send({
            type: MessageType.ChunkAck,
            fileName: message.fileName,
            offset: message.offset,
            bytesReceived: bytes.byteLength,
          } as z.infer<typeof Message>)

          if (message.final) {
            if (mimeType === '') {
              abort('This file type cannot be previewed.')
              return
            }
            settle(() =>
              resolve({ blob: new Blob(chunks, { type: mimeType }), mimeType }),
            )
          }
        }

        dataConnection.send({
          type: MessageType.Start,
          fileName,
          offset: 0,
        } as z.infer<typeof Message>)
      })
    },
    [dataConnection, filesInfo, isDownloading, isPreviewing],
  )

  const cancelPreview = useCallback(() => {
    // Safe to call at any time: the ref is null unless a preview is in flight.
    abortPreviewRef.current?.('Preview cancelled.')
  }, [])

  const stopDownload = useCallback(() => {
    // TODO(@kern): Continue here with stop / pause logic
    if (dataConnection) {
      console.log('[Downloader] pausing download')
      dataConnection.send({ type: MessageType.Pause })
      dataConnection.close()
    }
    setIsDownloading(false)
    setDone(false)
    setBytesDownloaded(0)
    setErrorMessage(null)
    // fileStreams.forEach((stream) => stream.cancel())
    // fileStreams.length = 0
    // Object.values(fileStreamByPath).forEach((stream) => stream.cancel())
    // Object.keys(fileStreamByPath).forEach((key) => delete fileStreamByPath[key])
    //   }, [dataConnection, fileStreams, fileStreamByPath])
  }, [dataConnection])

  return {
    filesInfo,
    isConnected,
    isPasswordRequired,
    isDownloading,
    isDone,
    errorMessage,
    submitPassword,
    startDownload,
    stopDownload,
    startPreview,
    cancelPreview,
    isPreviewing,
    previewBytes,
    totalSize: filesInfo?.reduce((acc, info) => acc + info.size, 0) ?? 0,
    bytesDownloaded,
  }
}
