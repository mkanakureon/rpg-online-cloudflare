// body.ts — 要求の本文を上限まで読む手伝い（本文を読む所は src/ でここ 1 か所）。
//
// Content-Length が上限を超えれば読まずに断る。無いとき（または嘘で小さいとき）は流れ（stream）を上限まで読み、
// 超えた所で読むのをやめて断る。断るときは 413 PAYLOAD_TOO_LARGE。上限は口ごとに渡す（セーブの PUT は
// saves/limits.ts の MAX_REQUEST_BYTES、ほかの口は MAX_JSON_BODY_BYTES）。検査の順は変えず、各口がいま本文を
// 読む所で呼ぶ。正は docs/guides/working/hardening-design.md §2.3 と docs/api-contract.md の「本文の大きさの上限」。
//
// 概要記述: Claude Opus 5.5 — 2026-11-10
import { error } from './http';

/** セーブの PUT のほかの、JSON の本文を受け取る口の上限（16 KiB）。 */
export const MAX_JSON_BODY_BYTES = 16_384;

export type BodyText = { ok: true; text: string } | { ok: false; response: Response };
export type BodyJson = { ok: true; value: unknown } | { ok: false; response: Response };

const tooLarge = () => error('PAYLOAD_TOO_LARGE', 'Request body too large', 413);

/** 本文を limit バイトまで読む。超えれば null（Content-Length が超えていれば読まない）。 */
export async function readBytes(req: Request, limit: number): Promise<Uint8Array | null> {
  const length = req.headers.get('Content-Length');
  if (length !== null && Number(length) > limit) return null;
  if (req.body === null) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return bytes;
}

/** 本文を limit バイトまで読んで UTF-8 の文字列にする。超えれば 413 の応答。 */
export async function readText(req: Request, limit: number): Promise<BodyText> {
  const bytes = await readBytes(req, limit);
  if (bytes === null) return { ok: false, response: tooLarge() };
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

/** 本文を limit バイトまで読んで JSON にする。超えれば 413、JSON でなければ 400 INVALID_JSON の応答。 */
export async function readJson(req: Request, limit: number = MAX_JSON_BODY_BYTES): Promise<BodyJson> {
  const read = await readText(req, limit);
  if (!read.ok) return read;
  try { return { ok: true, value: JSON.parse(read.text) as unknown }; }
  catch { return { ok: false, response: error('INVALID_JSON', 'Request body must be JSON', 400) }; }
}
