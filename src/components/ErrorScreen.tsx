// 描画の途中で例外が起きたときの画面（N21）。白い画面で止まらず、何が起きたか（ビルド番号と例外の内容）と、再読み込みの操作を出す。
// 翻訳が読めていなくても出せるよう、文言は言語ファイルに頼らず1か所に書く。
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/Button';
import { CodeBlock, Screen } from './ui/Screen';
import { Text } from './ui/Text';

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
      <Screen>
        <Text size="xl" bold layout={{ margin: '0 0 12px' }}>画面の表示で問題が起きました</Text>
        <Text size="l" layout={{ margin: '0 0 12px' }}>再読み込みすると、続きから遊べます。直らないときは、下の内容と一緒に報告してください。</Text>
        <CodeBlock layout={{ maxWidth: 720 }}>{`ビルド: ${__BUILD_ID__}\n${error.name}: ${error.message}`}</CodeBlock>
        <Button variant="alert" onClick={() => window.location.reload()}>
          再読み込み
        </Button>
      </Screen>
    );
  }
}
