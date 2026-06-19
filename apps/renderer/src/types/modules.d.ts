/**
 * 缺类型定义的 npm 包的 ambient declarations.
 * 第三方包没自带 .d.ts, 但用 dynamic import 加载, 所以需要在这里声明.
 */

declare module '@iarna/rtf-to-html' {
  type RtfToHtmlCallback = (err: Error) => void;
  const rtfToHtml: {
    fromString: (rtf: string, onError?: RtfToHtmlCallback) => Promise<string>;
  };
  export default rtfToHtml;
}
