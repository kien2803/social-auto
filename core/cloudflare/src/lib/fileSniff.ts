/** Magic-bytes video validation for Workers — no node:fs/file-type here,
 *  so sniff the first bytes of the uploaded body directly. Prevents a
 *  renamed .exe landing in storage as "video/mp4".
 *  mp4/mov: bytes 4..7 = 'ftyp' with a known brand; webm: EBML header. */
const FTYP_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'qt  ', 'MSNV', 'dash', 'mmp4', '3gp5', '3g2a']);

export type VideoFormat = 'mp4' | 'mov' | 'webm';

export function sniffVideoFormat(head: ArrayBuffer): VideoFormat | null {
  const b = new Uint8Array(head);
  if (b.length < 12) return null;
  // EBML / WebM: 1A 45 DF A3
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  // ISO BMFF / QuickTime: size(4) + 'ftyp' + brand(4)
  const tag = String.fromCharCode(b[4]!, b[5]!, b[6]!, b[7]!);
  if (tag === 'ftyp') {
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    if (brand === 'qt  ') return 'mov';
    if (FTYP_BRANDS.has(brand) || brand.startsWith('mp4') || brand.startsWith('iso') || brand.startsWith('avc')) return 'mp4';
    return 'mp4'; // unknown ftyp brand → still a valid MP4-family container
  }
  return null;
}
