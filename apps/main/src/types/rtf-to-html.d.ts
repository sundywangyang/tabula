declare module '@iarna/rtf-to-html' {
  const rtfToHtml: {
    fromString(rtf: string, callback: (error: Error | null, html?: string) => void): void;
  };
  export default rtfToHtml;
}
