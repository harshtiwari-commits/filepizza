import React, { JSX } from 'react'

export default function DownloadButton({
  onClick,
  disabled,
}: {
  onClick?: React.MouseEventHandler
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      id="download-button"
      onClick={onClick}
      disabled={disabled}
      className="h-12 px-4 bg-linear-to-b from-green-500 to-green-600 text-white rounded-md hover:from-green-500 hover:to-green-700 transition-all duration-200 border border-green-600 shadow-sm hover:shadow-md text-shadow disabled:opacity-40 disabled:cursor-not-allowed"
    >
      Download
    </button>
  )
}
