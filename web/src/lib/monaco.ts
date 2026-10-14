import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Bundle Monaco locally (no CDN) so y-monaco and the editor share one instance.
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};

monaco.editor.defineTheme('debugroom-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '5c6370', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c678dd' },
    { token: 'string', foreground: '98c379' },
    { token: 'number', foreground: 'd19a66' },
    { token: 'type', foreground: 'e5c07b' },
    { token: 'identifier', foreground: 'abb2bf' },
    { token: 'delimiter', foreground: 'abb2bf' },
  ],
  colors: {
    'editor.background': '#181a1f',
    'editor.foreground': '#abb2bf',
    'editorLineNumber.foreground': '#4b5263',
    'editorLineNumber.activeForeground': '#9aa3b2',
    'editor.lineHighlightBackground': '#1d2025',
    'editor.lineHighlightBorder': '#00000000',
    'editorGutter.background': '#181a1f',
    'editor.selectionBackground': '#6fa3e03a',
    'editorCursor.foreground': '#6fa3e0',
    'editorIndentGuide.background1': '#242831',
    'editorIndentGuide.activeBackground1': '#3b4150',
    'editorWidget.background': '#1d2025',
    'scrollbarSlider.background': '#3b415066',
  },
});

export { monaco };
