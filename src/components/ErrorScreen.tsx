// 描画の途中で例外が起きたときの画面（N21）。白い画面で止まらず、何が起きたか（ビルド番号と例外の内容）と、再読み込みの操作を出す。
// 翻訳が読めていなくても出せるよう、文言は言語ファイルに頼らず1か所に書く。
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorScreen extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('描画の途中で例外が起きた', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        style={{ minHeight: '100vh', boxSizing: 'border-box', padding: 24, background: '#25406f', color: '#f4f1e6', fontFamily: 'sans-serif', lineHeight: 1.6 }}
      >
        <h1 style={{ fontSize: 20, margin: '0 0 12px' }}>画面の表示で問題が起きました</h1>
        <p style={{ margin: '0 0 12px' }}>再読み込みすると、続きから遊べます。直らないときは、下の内容と一緒に報告してください。</p>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#1d3664', padding: 12, fontSize: 13, maxWidth: 720, overflowX: 'auto' }}>
          {`ビルド: ${__BUILD_ID__}\n${error.name}: ${error.message}`}
        </pre>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: '8px 16px', cursor: 'pointer', background: '#ffd866', color: '#1d3664', border: 'none', fontWeight: 'bold', fontSize: 15 }}
        >
          再読み込み
        </button>
      </div>
    );
  }
}
