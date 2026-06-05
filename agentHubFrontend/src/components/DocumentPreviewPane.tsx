import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import type { WorkspaceDocumentPreview } from '../types'

type DocumentPreviewPaneProps = {
  preview: WorkspaceDocumentPreview
}

/**
 * Renders one browser-side preview for PDF, DOCX, or PPTX files.
 * Input: normalized preview metadata with one source URL.
 * Output: iframe or in-browser rendered document content.
 */
export function DocumentPreviewPane({ preview }: DocumentPreviewPaneProps) {
  const docxContainerRef = useRef<HTMLDivElement | null>(null)
  const pptxContainerRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    preview.kind === 'pdf' ? 'ready' : 'loading',
  )
  const [error, setError] = useState('')

  useEffect(() => {
    if (preview.kind === 'pdf') {
      setStatus('ready')
      setError('')
      return
    }

    const container = preview.kind === 'docx' ? docxContainerRef.current : pptxContainerRef.current
    if (!container) {
      return
    }

    let cancelled = false
    let viewer: { destroy: () => void } | undefined
    container.innerHTML = ''
    setStatus('loading')
    setError('')

    async function loadPreview(target: HTMLDivElement): Promise<void> {
      try {
        const response = await fetch(preview.sourceUrl)
        if (!response.ok) {
          throw new Error(`预览文件加载失败：${response.status}`)
        }
        const fileBlob = await response.blob()
        if (cancelled) {
          return
        }

        if (preview.kind === 'docx') {
          const { renderAsync } = await import('docx-preview')
          await renderAsync(fileBlob, target, undefined, {
            className: 'agenthub-docx',
            inWrapper: true,
            breakPages: true,
            ignoreLastRenderedPageBreak: false,
            useBase64URL: true,
          })
        } else {
          const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import('@aiden0z/pptx-renderer')
          viewer = await PptxViewer.open(await fileBlob.arrayBuffer(), target, {
            zipLimits: RECOMMENDED_ZIP_LIMITS,
            renderMode: 'list',
            listOptions: {
              windowed: true,
              initialSlides: 4,
              batchSize: 6,
              showSlideLabels: true,
            },
          })
        }

        if (!cancelled) {
          setStatus('ready')
        }
      } catch (caughtError) {
        if (cancelled) {
          return
        }

        const message = caughtError instanceof Error ? caughtError.message : '文档预览加载失败。'
        setError(message)
        setStatus('error')
      }
    }

    void loadPreview(container)

    return () => {
      cancelled = true
      viewer?.destroy()
      container.innerHTML = ''
    }
  }, [preview.kind, preview.sourceUrl])

  if (preview.kind === 'pdf') {
    return (
      <div className="code-document-preview">
        <iframe
          className="code-document-preview__frame"
          src={preview.sourceUrl}
          title={preview.path}
        />
      </div>
    )
  }

  return (
    <div className="code-document-preview code-document-preview--rich">
      <header className="code-document-preview__header">
        <strong>{preview.name}</strong>
        <span>{preview.summary}</span>
      </header>
      {status !== 'ready' ? (
        <div className={`code-document-preview__status ${status === 'error' ? 'is-error' : ''}`}>
          {status === 'error' ? <AlertTriangle size={18} /> : <LoaderCircle className="icon-spin" size={18} />}
          <strong>{status === 'error' ? '预览加载失败' : '正在加载文档预览'}</strong>
          <p>{status === 'error' ? error : '首次加载会在浏览器中解析文档内容，请稍等。'}</p>
        </div>
      ) : null}
      <div
        className={`code-document-preview__body code-document-preview__body--rendered ${
          status !== 'ready' ? 'is-hidden' : ''
        }`}
      >
        {preview.kind === 'docx' ? (
          <div className="code-document-preview__render-surface code-document-preview__render-surface--docx" ref={docxContainerRef} />
        ) : (
          <div className="code-document-preview__render-surface code-document-preview__render-surface--pptx" ref={pptxContainerRef} />
        )}
      </div>
    </div>
  )
}
