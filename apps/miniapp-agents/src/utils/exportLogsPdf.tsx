import { createRoot } from 'react-dom/client'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { LogReportDocument } from '../components/LogReportDocument'
import type { LogReportModel } from '../components/LogReportDocument'

const A4_PT = { w: 595.28, h: 841.89 }

export async function exportLogsPdf(model: LogReportModel, filename: string): Promise<void> {
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.top = '0px'
  host.style.left = '-20000px'
  host.style.zIndex = '-1'
  host.style.opacity = '0'
  document.body.appendChild(host)

  const root = createRoot(host)
  try {
    await new Promise<void>((resolve) => {
      root.render(<LogReportDocument model={model} onReady={() => resolve()} />)
    })

    try {
      if (document.fonts?.ready) await document.fonts.ready
    } catch {
      /* font API unavailable */
    }
    await new Promise((r) => setTimeout(r, 150))

    const pages = Array.from(host.querySelectorAll<HTMLElement>('[data-report-page]'))
    if (pages.length === 0) throw new Error('report render produced no pages')

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true })
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], {
        scale: Math.min(2, Math.max(1.5, window.devicePixelRatio || 1)),
        backgroundColor: '#fffdf9',
        logging: false,
        useCORS: true,
      })
      const img = canvas.toDataURL('image/jpeg', 0.92)
      if (i > 0) pdf.addPage()
      pdf.addImage(img, 'JPEG', 0, 0, A4_PT.w, A4_PT.h, undefined, 'FAST')
    }
    pdf.save(filename)
  } finally {
    root.unmount()
    host.remove()
  }
}
