import { describe, it, expect } from 'vitest';
import {
  getLineMetrics,
  offsetToRowCol,
  rowColToOffset,
  moveCursorVertical,
  moveToLineStart,
  moveToLineEnd,
  deleteToLineStart,
  deleteToLineEnd,
  deleteWordBefore,
  getVisibleLinesWindow,
} from '../text-buffer.js';

describe('text-buffer', () => {
  describe('getLineMetrics', () => {
    it('handles empty string', () => {
      const res = getLineMetrics('');
      expect(res.lines).toEqual(['']);
      expect(res.starts).toEqual([0]);
      expect(res.ends).toEqual([0]);
    });

    it('handles single line string', () => {
      const res = getLineMetrics('hello');
      expect(res.lines).toEqual(['hello']);
      expect(res.starts).toEqual([0]);
      expect(res.ends).toEqual([5]);
    });

    it('handles multi-line text with exact starts and ends', () => {
      const res = getLineMetrics('hello\nworld');
      expect(res.lines).toEqual(['hello', 'world']);
      expect(res.starts).toEqual([0, 6]);
      expect(res.ends).toEqual([5, 11]);
    });

    it('handles leading, trailing, and consecutive newlines', () => {
      const res = getLineMetrics('\na\n\nb\n');
      expect(res.lines).toEqual(['', 'a', '', 'b', '']);
      expect(res.starts).toEqual([0, 1, 3, 4, 6]);
      expect(res.ends).toEqual([0, 2, 3, 5, 6]);
    });
  });

  describe('offsetToRowCol', () => {
    it('converts offsets on empty text and clamps boundaries', () => {
      expect(offsetToRowCol('', 0)).toEqual({ row: 0, col: 0 });
      expect(offsetToRowCol('', 5)).toEqual({ row: 0, col: 0 });
      expect(offsetToRowCol('', -1)).toEqual({ row: 0, col: 0 });
    });

    it('converts offsets accurately for multi-line text', () => {
      const text = 'abc\ndef';
      expect(offsetToRowCol(text, 0)).toEqual({ row: 0, col: 0 });
      expect(offsetToRowCol(text, 2)).toEqual({ row: 0, col: 2 });
      expect(offsetToRowCol(text, 3)).toEqual({ row: 0, col: 3 }); // end of line 0
      expect(offsetToRowCol(text, 4)).toEqual({ row: 1, col: 0 }); // start of line 1
      expect(offsetToRowCol(text, 7)).toEqual({ row: 1, col: 3 }); // end of line 1
      expect(offsetToRowCol(text, 100)).toEqual({ row: 1, col: 3 }); // clamped
    });

    it('handles empty lines in between', () => {
      const text = 'a\n\nb';
      expect(offsetToRowCol(text, 1)).toEqual({ row: 0, col: 1 });
      expect(offsetToRowCol(text, 2)).toEqual({ row: 1, col: 0 });
      expect(offsetToRowCol(text, 3)).toEqual({ row: 2, col: 0 });
    });
  });

  describe('rowColToOffset', () => {
    it('converts row/col to 1D offset with clamping', () => {
      const text = 'abc\ndef';
      expect(rowColToOffset(text, 0, 0)).toBe(0);
      expect(rowColToOffset(text, 0, 2)).toBe(2);
      expect(rowColToOffset(text, 0, 3)).toBe(3);
      expect(rowColToOffset(text, 0, 10)).toBe(3); // col clamped to line length
      expect(rowColToOffset(text, 1, 0)).toBe(4);
      expect(rowColToOffset(text, 1, 3)).toBe(7);
      expect(rowColToOffset(text, 5, 0)).toBe(4); // row clamped to 1
      expect(rowColToOffset(text, -1, 0)).toBe(0); // row clamped to 0
    });

    it('preserves roundtrip consistency between offset and rowCol', () => {
      const text = 'alpha\nbeta\ngamma\ndelta';
      for (let offset = 0; offset <= text.length; offset++) {
        const { row, col } = offsetToRowCol(text, offset);
        const back = rowColToOffset(text, row, col);
        expect(back).toBe(offset);
      }
    });
  });

  describe('moveCursorVertical', () => {
    it('escapes on single-line text for both up and down', () => {
      const text = 'hello';
      const up = moveCursorVertical(text, 2, -1);
      expect(up.escaped).toBe(true);
      expect(up.nextOffset).toBe(2);
      expect(up.newPreferredCol).toBe(2);

      const down = moveCursorVertical(text, 2, 1);
      expect(down.escaped).toBe(true);
      expect(down.nextOffset).toBe(2);
      expect(down.newPreferredCol).toBe(2);
    });

    it('escapes at top row moving up and bottom row moving down', () => {
      const text = 'line1\nline2';
      const up = moveCursorVertical(text, 2, -1);
      expect(up.escaped).toBe(true);

      const downAtBottom = moveCursorVertical(text, 8, 1);
      expect(downAtBottom.escaped).toBe(true);
    });

    it('navigates lines vertically without escaping in between', () => {
      const text = 'line1\nline2\nline3';
      // From line 0 (offset 2 'n') down to line 1
      const down1 = moveCursorVertical(text, 2, 1);
      expect(down1.escaped).toBe(false);
      expect(down1.nextOffset).toBe(8); // 'line2' offset 6 + 2 = 8
      expect(down1.newPreferredCol).toBe(2);

      // Down to line 2
      const down2 = moveCursorVertical(text, 8, 1, down1.newPreferredCol);
      expect(down2.escaped).toBe(false);
      expect(down2.nextOffset).toBe(14); // 'line3' offset 12 + 2 = 14

      // Up back to line 1
      const up1 = moveCursorVertical(text, 14, -1, down2.newPreferredCol);
      expect(up1.escaped).toBe(false);
      expect(up1.nextOffset).toBe(8);
    });

    it('maintains preferredCol when traversing shorter intermediate lines', () => {
      const text = 'longline\nx\nlongline';
      // Line 0 col 6
      const downToShort = moveCursorVertical(text, 6, 1);
      expect(downToShort.escaped).toBe(false);
      // Clamped to end of 'x' (offset 9 + 1 = 10)
      expect(downToShort.nextOffset).toBe(10);
      expect(downToShort.newPreferredCol).toBe(6);

      // Down to next long line using preferredCol 6
      const downToLong = moveCursorVertical(text, downToShort.nextOffset, 1, downToShort.newPreferredCol);
      expect(downToLong.escaped).toBe(false);
      // Lands back on col 6 of line 2 (offset 11 + 6 = 17)
      expect(downToLong.nextOffset).toBe(17);
      expect(downToLong.newPreferredCol).toBe(6);
    });
  });

  describe('moveToLineStart & moveToLineEnd', () => {
    const text = 'hello\nbeautiful\nworld';

    it('moves to line start across lines', () => {
      expect(moveToLineStart(text, 2)).toBe(0);
      expect(moveToLineStart(text, 9)).toBe(6); // 'beautiful' starts at 6
      expect(moveToLineStart(text, 18)).toBe(16); // 'world' starts at 16
    });

    it('moves to line end across lines', () => {
      expect(moveToLineEnd(text, 1)).toBe(5);
      expect(moveToLineEnd(text, 8)).toBe(15);
      expect(moveToLineEnd(text, 17)).toBe(21);
    });
  });

  describe('deleteToLineStart (Ctrl+U)', () => {
    it('deletes from cursor to start of line in single-line text', () => {
      const res = deleteToLineStart('hello world', 5);
      expect(res.text).toBe(' world');
      expect(res.offset).toBe(0);
    });

    it('deletes only within the current line in multi-line text', () => {
      const res = deleteToLineStart('line1\nline2\nline3', 8); // 'line2' offset 6..11, cursor at 8 ('li')
      expect(res.text).toBe('line1\nne2\nline3');
      expect(res.offset).toBe(6);
    });

    it('no-op when already at line start', () => {
      const res = deleteToLineStart('line1\nline2', 6);
      expect(res.text).toBe('line1\nline2');
      expect(res.offset).toBe(6);
    });
  });

  describe('deleteToLineEnd (Ctrl+K)', () => {
    it('deletes from cursor to end of current line', () => {
      const res = deleteToLineEnd('hello world', 5);
      expect(res.text).toBe('hello');
      expect(res.offset).toBe(5);
    });

    it('deletes within current line in multi-line text', () => {
      const res = deleteToLineEnd('hello\nworld', 2);
      expect(res.text).toBe('he\nworld');
      expect(res.offset).toBe(2);
    });

    it('deletes newline to join with next line when cursor is at line end', () => {
      const res = deleteToLineEnd('hello\nworld', 5);
      expect(res.text).toBe('helloworld');
      expect(res.offset).toBe(5);
    });

    it('no-op when at end of the last line', () => {
      const res = deleteToLineEnd('hello\nworld', 11);
      expect(res.text).toBe('hello\nworld');
      expect(res.offset).toBe(11);
    });
  });

  describe('deleteWordBefore (Ctrl+W)', () => {
    it('returns empty text and offset 0 on offset 0', () => {
      expect(deleteWordBefore('hello', 0)).toEqual({ text: 'hello', offset: 0 });
    });

    it('deletes word before cursor in single line', () => {
      const res = deleteWordBefore('hello world', 11);
      expect(res.text).toBe('hello ');
      expect(res.offset).toBe(6);
    });

    it('deletes trailing spaces and word before cursor', () => {
      const res = deleteWordBefore('hello world   ', 14);
      expect(res.text).toBe('hello ');
      expect(res.offset).toBe(6);
    });

    it('deletes punctuation symbols as distinct word chunks', () => {
      const res1 = deleteWordBefore('foo/bar', 7);
      expect(res1.text).toBe('foo/');
      expect(res1.offset).toBe(4);

      const res2 = deleteWordBefore('foo/', 4);
      expect(res2.text).toBe('foo');
      expect(res2.offset).toBe(3);
    });

    it('does not cross newline boundary into previous line', () => {
      const res = deleteWordBefore('line1\n  line2', 13);
      expect(res.text).toBe('line1\n  ');
      expect(res.offset).toBe(8);

      const res2 = deleteWordBefore('line1\n  ', 8);
      expect(res2.text).toBe('line1\n');
      expect(res2.offset).toBe(6);
    });
  });

  describe('getVisibleLinesWindow', () => {
    it('returns all lines when line count <= maxRows', () => {
      const lines = ['a', 'b', 'c'];
      const res = getVisibleLinesWindow(lines, 1, 5);
      expect(res.visibleLines).toEqual(['a', 'b', 'c']);
      expect(res.startLineIndex).toBe(0);
    });

    it('scrolls window when cursor is beyond maxRows', () => {
      const lines = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
      // Cursor on line 0..4 keeps startLineIndex 0
      expect(getVisibleLinesWindow(lines, 0, 5)).toEqual({
        visibleLines: ['0', '1', '2', '3', '4'],
        startLineIndex: 0,
      });
      expect(getVisibleLinesWindow(lines, 4, 5)).toEqual({
        visibleLines: ['0', '1', '2', '3', '4'],
        startLineIndex: 0,
      });

      // Cursor on line 5 moves window to lines 1..5
      expect(getVisibleLinesWindow(lines, 5, 5)).toEqual({
        visibleLines: ['1', '2', '3', '4', '5'],
        startLineIndex: 1,
      });

      // Cursor at the very bottom (line 9)
      expect(getVisibleLinesWindow(lines, 9, 5)).toEqual({
        visibleLines: ['5', '6', '7', '8', '9'],
        startLineIndex: 5,
      });
    });

    it('supports hysteresis with prevStartLineIndex', () => {
      const lines = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
      // While prev is 2 (lines 2..6), cursor at 4 stays at startLineIndex 2
      const res = getVisibleLinesWindow(lines, 4, 5, 2);
      expect(res.startLineIndex).toBe(2);
      expect(res.visibleLines).toEqual(['2', '3', '4', '5', '6']);

      // Cursor moves up to 1 -> window shifts up
      const resUp = getVisibleLinesWindow(lines, 1, 5, 2);
      expect(resUp.startLineIndex).toBe(1);

      // Cursor moves down to 7 -> window shifts down
      const resDown = getVisibleLinesWindow(lines, 7, 5, 2);
      expect(resDown.startLineIndex).toBe(3);
    });
  });
});
