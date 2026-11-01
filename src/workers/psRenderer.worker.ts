import { psToSvg } from './psInterpreter'

const ctx = self as unknown as Worker

ctx.onmessage = (e: MessageEvent<{ id: number; ps: ArrayBuffer }>) => {
  const { id, ps } = e.data
  try {
    const { svg, warnings } = psToSvg(ps)
    ctx.postMessage({ id, svg, warnings })
  } catch (err) {
    ctx.postMessage({ id, error: (err as Error).message })
  }
}
