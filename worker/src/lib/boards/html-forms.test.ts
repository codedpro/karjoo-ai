/**
 * تست‌های خواندنِ فرم بدونِ DOM.
 *
 * این توابع جایگزینِ `DOMParser`ِ افزونه روی سرورند، پس قرارداد مهم این است: دقیقاً
 * همان چیزی برگردد که مرورگر می‌فرستاد — نه بیشتر (فیلدِ تیک‌نخورده/غیرفعال) و نه
 * کمتر (selectِ بدونِ انتخاب که مرورگر اولی را می‌فرستد).
 */
import { describe, expect, it } from "vitest";

import {
  attribute,
  collectFormFields,
  csrfTokenFromHtml,
  decodeEntities,
  fileInputName,
  formBlocks,
  stripTags,
} from "./html-forms.js";

describe("attribute", () => {
  it("نقلِ دوتایی، تکی و بدونِ نقل را می‌خواند", () => {
    expect(attribute('name="a" value="b"', "value")).toBe("b");
    expect(attribute("name='a' value='b'", "value")).toBe("b");
    expect(attribute("name=a value=b ", "value")).toBe("b");
  });

  it("ویژگیِ نبوده undefined است (نه رشته‌ی خالی)", () => {
    expect(attribute('name="a"', "value")).toBeUndefined();
  });

  it("مقدارِ خالی را رشته‌ی خالی برمی‌گرداند، نه undefined", () => {
    expect(attribute('name="a" value=""', "value")).toBe("");
  });
});

describe("decodeEntities", () => {
  it("&amp; را آخر باز می‌کند تا موجودیتِ دوبارکدشده خراب نشود", () => {
    expect(decodeEntities("a &amp;lt; b")).toBe("a &lt; b");
    expect(decodeEntities("a &lt; b")).toBe("a < b");
    expect(decodeEntities("x&nbsp;y")).toBe("x y");
  });
});

describe("collectFormFields", () => {
  it("متن، textarea و selectِ انتخاب‌شده را برمی‌دارد", () => {
    const html = `
      <input type="text" name="first" value="علی">
      <textarea name="bio">  چند خط  </textarea>
      <select name="city">
        <option value="1">تهران</option>
        <option value="2" selected>شیراز</option>
      </select>`;
    expect(collectFormFields(html)).toEqual([
      ["first", "علی"],
      ["bio", "چند خط"],
      ["city", "2"],
    ]);
  });

  it("مثلِ مرورگر، وقتی هیچ گزینه‌ای selected نیست اولی را می‌فرستد", () => {
    const html = `<select name="c"><option value="1">a</option><option value="2">b</option></select>`;
    expect(collectFormFields(html)).toEqual([["c", "1"]]);
  });

  it("رادیو/چک‌باکسِ تیک‌نخورده فرستاده نمی‌شود", () => {
    const html = `
      <input type="checkbox" name="agree" value="1">
      <input type="radio" name="g" value="m" checked>
      <input type="radio" name="g" value="f">`;
    expect(collectFormFields(html)).toEqual([["g", "m"]]);
  });

  it("ورودیِ فایل، دکمه و فیلدِ disabled بیرون می‌مانند", () => {
    const html = `
      <input type="file" name="cv">
      <input type="submit" name="go" value="send">
      <input type="text" name="x" value="1" disabled>
      <input type="text" name="y" value="2">`;
    expect(collectFormFields(html)).toEqual([["y", "2"]]);
  });

  it("با includeButtons دکمه‌ها هم می‌آیند (برای کشفِ کنترلِ حذف)", () => {
    const html = `<input type="submit" name="action" value="حذف">`;
    expect(collectFormFields(html, { includeButtons: true })).toEqual([["action", "حذف"]]);
  });

  it("optionِ بدونِ value متنِ خودش را می‌فرستد", () => {
    const html = `<select name="c"><option selected>تهران</option></select>`;
    expect(collectFormFields(html)).toEqual([["c", "تهران"]]);
  });
});

describe("fileInputName", () => {
  it("نامِ اولین ورودیِ فایل را می‌دهد، وگرنه null", () => {
    expect(fileInputName(`<input type="file" name="resume">`)).toBe("resume");
    expect(fileInputName(`<input type="text" name="a">`)).toBeNull();
  });
});

describe("formBlocks", () => {
  it("هر فرم را با تگِ باز و محتوای خودش جدا می‌کند", () => {
    const blocks = formBlocks(`<form action="/a"><input name="x"></form><form action="/b"></form>`);
    expect(blocks).toHaveLength(2);
    expect(attribute(blocks[0]!.openTag, "action")).toBe("/a");
    expect(blocks[0]!.inner).toContain('name="x"');
  });
});

describe("csrfTokenFromHtml", () => {
  it("از meta یا از input[name=_token] می‌خواند", () => {
    expect(csrfTokenFromHtml(`<meta name="csrf-token" content="TOK">`)).toBe("TOK");
    expect(csrfTokenFromHtml(`<input name="_token" value="TOK2">`)).toBe("TOK2");
    expect(csrfTokenFromHtml(`<meta name="other" content="x">`)).toBeNull();
  });
});

describe("stripTags", () => {
  it("متنِ خوانا می‌دهد و script/style را دور می‌ریزد", () => {
    expect(stripTags(`<div>سلام <b>دنیا</b><script>bad()</script></div>`)).toBe("سلام دنیا");
  });
});
