// 上に固定する部分（タブ・検索・並べ替え）と、スクロールする一覧を持つウィンドウの中身（N105）。Window の scroll="inner" と組で使う。
// 縦に並べ、タブ（tabs）と板の中の上の部分（head）は高さを固定し、一覧（children）だけが板の中でスクロールする。
// 高さの受け渡しとスクロールはここだけで書き、使う側（インベントリ・店・依頼）では高さやスクロールを書かない。
// scrollKey が替わったら（タブの切り替え・検索の文字）、一覧を一番上に戻す
import { useEffect, useRef, type ReactNode } from 'react';
import { TabPanel } from './Tabs';
import type { TabTone } from './ui/Tab';

interface Props {
  tabs?: ReactNode;
  panel: { tone: TabTone; id?: string; labelledBy?: string };
  head?: ReactNode;
  scrollKey?: string;
  children: ReactNode;
}

export function TabbedBody({ tabs, panel, head, scrollKey, children }: Props) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: 0 });
  }, [scrollKey]);
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {tabs}
      <TabPanel tone={panel.tone} id={panel.id} labelledBy={panel.labelledBy} layout={{ flex: 1, minHeight: 0 }}>
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {head !== undefined && <div style={{ flex: 'none' }}>{head}</div>}
          <div ref={list} style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
            {children}
          </div>
        </div>
      </TabPanel>
    </div>
  );
}
