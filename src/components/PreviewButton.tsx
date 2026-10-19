import React, { JSX } from 'react'

export default function PreviewButton({
  onClick,
  disabled,
  title,
}: {
  onClick?: React.MouseEventHandler
  disabled?: boolean
  title?: string
}): JSX.Element {
  return (
    <button
      id="preview-button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-2 py-1 text-xs font-semibold rounded border border-stone-300 dark:border-stone-600 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      Preview
    </button>
  )
}
