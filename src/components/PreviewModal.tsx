'use client'

import React, { JSX, useCallback, useEffect, useState } from 'react'
import { formatSize } from '../fs'

type FileInfo = {
  fileName: string
  size: number
  type: string
}

type PreviewResult = { blob: Blob; mimeType: string }

type ModalState =
  | { status: 'loading' }
  | { status: 'ready'; blob: Blob; mimeType: string }
  | { status: 'error'; message: string }

export default function PreviewModal({
  file,
  previewBytes,
  startPreview,
  cancelPreview,
  onClose,
  onDownload,
}: {
  file: FileInfo
  previewBytes: number
  startPreview: (fileName: string) => Promise<PreviewResult>
  cancelPreview: () => void
  onClose: () => void
  onDownload: () => void
}): JSX.Element {
  const [state, setState] = useState<ModalState>({ status: 'loading' })
  const [objectURL, setObjectURL] = useState<string | null>(null)

  // Kick off the transfer when the modal opens, and give it up if we unmount.
  useEffect(() => {
    let cancelled = false

    startPreview(file.fileName)
      .then((result) => {
        if (cancelled) return
        setState({ status: 'ready', ...result })
      })
      .catch((err: Error) => {
        if (cancelled) return
        setState({ status: 'error', message: err.message })
      })

    return () => {
      cancelled = true
      cancelPreview()
    }
  }, [file.fileName, startPreview, cancelPreview])

  // Mint the object URL once we have a blob, and always revoke it again.
  useEffect(() => {
    if (state.status !== 'ready') return
    const url = URL.createObjectURL(state.blob)
    setObjectURL(url)
    return () => {
      URL.revokeObjectURL(url)
      setObjectURL(null)
    }
  }, [state])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleDownload = useCallback(() => {
    onClose()
    onDownload()
  }, [onClose, onDownload])

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-title"
      onClick={onClose}
    >
      <div
        className="bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-4 border-b border-stone-200 dark:border-stone-700">
          <h2
            id="preview-title"
            className="text-sm font-semibold text-stone-900 dark:text-stone-50 truncate"
          >
            {file.fileName}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close preview"
            className="text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto flex items-center justify-center p-4 min-h-[16rem]">
          {state.status === 'loading' && (
            <div className="flex flex-col items-center space-y-3 py-8">
              <p className="text-sm text-stone-600 dark:text-stone-300">
                Receiving… {formatSize(previewBytes)} of {formatSize(file.size)}
              </p>
              <div className="w-64 h-2 rounded-full bg-stone-200 dark:bg-stone-700 overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all duration-200"
                  style={{
                    width: `${
                      file.size > 0
                        ? Math.min(
                            100,
                            Math.round((previewBytes / file.size) * 100),
                          )
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          {state.status === 'error' && (
            <p className="text-sm text-stone-600 dark:text-stone-300 text-center max-w-md">
              {state.message}
            </p>
          )}

          {state.status === 'ready' && objectURL && (
            <img
              src={objectURL}
              alt={file.fileName}
              className="max-w-full max-h-[60vh] object-contain"
            />
          )}
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-stone-200 dark:border-stone-700">
          <button
            onClick={handleDownload}
            className="h-10 px-4 bg-linear-to-b from-green-500 to-green-600 text-white rounded-md hover:from-green-500 hover:to-green-700 transition-all duration-200 border border-green-600 shadow-sm text-sm"
          >
            Download
          </button>
        </div>
      </div>
    </div>
  )
}
