/**
 * html-to-markdown.test.ts - htmlToMarkdown 单元测试
 *
 * 验证：健壮性（永不抛错）、基本转换、噪声标签移除、超大输入截断、
 * 异常 fallback、Content-Type 友好的输出格式。
 */

import { describe, it, expect } from 'vitest';
import { htmlToMarkdown } from '../html-to-markdown.js';

describe('htmlToMarkdown', () => {
  // ─── 边界情况 ──────────────────────────────────────────────
  it('空字符串返回空字符串', () => {
    expect(htmlToMarkdown('')).toBe('');
  });

  it('纯空白输入返回空字符串', () => {
    expect(htmlToMarkdown('   \n\t  ')).toBe('');
  });

  it('永不抛错（损坏 HTML）', () => {
    const malformed = '<<<<>>>>';
    expect(() => htmlToMarkdown(malformed)).not.toThrow();
  });

  it('永不抛错（未闭合标签）', () => {
    const html = '<div><p>未闭合<span>嵌套';
    expect(() => htmlToMarkdown(html)).not.toThrow();
  });

  // ─── 基本转换 ──────────────────────────────────────────────
  it('h1 转 # 标题', () => {
    const md = htmlToMarkdown('<h1>天气</h1>');
    expect(md).toContain('# 天气');
  });

  it('段落保留文本', () => {
    const md = htmlToMarkdown('<p>今天晴 25度</p>');
    expect(md).toContain('今天晴 25度');
  });

  it('链接转 [text](url)', () => {
    const md = htmlToMarkdown('<a href="https://example.com">链接</a>');
    expect(md).toContain('[链接]');
    expect(md).toContain('https://example.com');
  });

  it('列表转 markdown 列表', () => {
    const md = htmlToMarkdown('<ul><li>第一</li><li>第二</li></ul>');
    expect(md).toContain('第一');
    expect(md).toContain('第二');
    expect(md).toMatch(/^[-*\s]/m);
  });

  // ─── 噪声标签移除 ──────────────────────────────────────────
  it('移除 script 内容', () => {
    const md = htmlToMarkdown('<p>保留</p><script>alert("xss")</script>');
    expect(md).toContain('保留');
    expect(md).not.toContain('alert');
    expect(md).not.toContain('xss');
  });

  it('移除 style 内容', () => {
    const md = htmlToMarkdown('<p>正文</p><style>body { color: red; }</style>');
    expect(md).toContain('正文');
    expect(md).not.toContain('color');
    expect(md).not.toContain('red');
  });

  it('移除 nav/header/footer', () => {
    const md = htmlToMarkdown(
      '<header>页头</header><nav>导航</nav><main>正文</main><footer>页脚</footer>'
    );
    expect(md).toContain('正文');
    expect(md).not.toContain('页头');
    expect(md).not.toContain('导航');
    expect(md).not.toContain('页脚');
  });

  // ─── 长度限制 ──────────────────────────────────────────────
  it('超大输入提前截断（防 OOM）', () => {
    // 构造 > 500KB 的 HTML
    const big = '<p>' + 'a'.repeat(600_000) + '</p>';
    const md = htmlToMarkdown(big);
    // 输出必包含 [content truncated] 标记
    expect(md).toContain('[content truncated]');
  });

  it('maxLength 截断生效', () => {
    const md = htmlToMarkdown('<p>' + 'x'.repeat(1000) + '</p>', { maxLength: 100 });
    // 输出长度受 maxLength 限制 + truncated 标记
    expect(md.length).toBeLessThan(150);
    expect(md).toContain('[content truncated]');
  });

  // ─── 现实场景：天气页 ──────────────────────────────────────
  it('天气网页模拟：保留正文，去除噪声', () => {
    const html = `
      <html>
        <head><title>天气</title></head>
        <body>
          <nav>导航栏</nav>
          <main>
            <h1>北京天气</h1>
            <p>今天：晴 25°C</p>
            <ul>
              <li>湿度：45%</li>
              <li>风速：3 级</li>
            </ul>
          </main>
          <footer>版权信息</footer>
          <script>trackPageView()</script>
        </body>
      </html>
    `;
    const md = htmlToMarkdown(html);
    expect(md).toContain('北京天气');
    expect(md).toContain('晴 25°C');
    expect(md).toContain('湿度');
    expect(md).toContain('风速');
    expect(md).not.toContain('导航栏');
    expect(md).not.toContain('版权信息');
    expect(md).not.toContain('trackPageView');
  });
});