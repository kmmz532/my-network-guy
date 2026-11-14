import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { FileButton } from './FileButton';

vi.mock('./tokens.css', () => ({}));
vi.mock('./ui.css', () => ({}));

const css = readFileSync(new URL('./ui.css', import.meta.url), 'utf8');
const noop = () => undefined;

describe('Button', () => {
  it('既定は type=button で、種類と大きさのクラスを持つ', () => {
    const html = renderToStaticMarkup(<Button variant="secondary" onClick={noop}>ok</Button>);
    expect(html).toContain('type="button"');
    expect(html).toContain('ui-button--secondary');
    expect(html).toContain('ui-button--m');
    expect(html).not.toContain('aria-pressed');
    expect(html).not.toContain('title=');
    expect(html).not.toContain('aria-label');
  });

  it('pressed・title・type・label が属性になる', () => {
    const html = renderToStaticMarkup(
      <Button variant="outline" size="choice" pressed title="説明" type="submit" label="名前" onClick={noop}>
        ok
      </Button>,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('title="説明"');
    expect(html).toContain('type="submit"');
    expect(html).toContain('aria-label="名前"');
    expect(html).toContain('ui-button--choice');
  });

  it('pressed が false のときは aria-pressed="false" になる', () => {
    expect(renderToStaticMarkup(<Button variant="secondary" pressed={false} onClick={noop}>ok</Button>)).toContain('aria-pressed="false"');
  });

  it('disabled と layout が渡る', () => {
    const html = renderToStaticMarkup(
      <Button variant="primary" disabled layout={{ width: '100%', minHeight: 36 }} onClick={noop}>
        ok
      </Button>,
    );
    expect(html).toContain('disabled');
    expect(html).toContain('width:100%');
    expect(html).toContain('min-height:36px');
  });

  it('FileButton は新しい種類と大きさを受け付ける', () => {
    const html = renderToStaticMarkup(<FileButton variant="secondary" size="menu" accept="application/json" onFile={noop}>読み込み</FileButton>);
    expect(html).toContain('ui-button--menu');
  });

  it('ui.css に、種類・大きさ・選択中の規則がある', () => {
    for (const name of ['outline', 'fit', 'choice', 'menu']) expect(css).toContain(`.ui-button--${name} {`);
    expect(css).toContain(".ui-button--secondary[aria-pressed='true']");
    expect(css).toContain(".ui-button--outline[aria-pressed='true']");
  });
});
