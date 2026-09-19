// Ambient declaration working around a real packaging bug in the installed
// library (v1.2.1): its package.json `exports["."]` map has `import`/
// `require` conditions but no `types` condition, so TypeScript's NodeNext
// module resolution can't find `index.d.ts` even though the file exists and
// is correct - confirmed by reading node_modules/@remotemerge/
// nepali-date-converter/{package.json,index.d.ts} directly. This mirrors
// that file's shape exactly; delete this once the library ships a fixed
// `exports` map.
declare module '@remotemerge/nepali-date-converter' {
  export default class DateConverter {
    constructor(dateInput: string);
    toAd(): { year: number; month: number; date: number; day: string };
    toBs(): { year: number; month: number; date: number; day: string };
  }
}
