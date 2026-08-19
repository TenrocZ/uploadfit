import { describe, expect, it } from 'vitest';
import {
  CNIPA_HOST,
  cnipaPublicGuideAdapter,
  getCnipaPageRuleContext
} from '../../src/adapters/cnipa-public-guide.js';
import { parseRulesDeterministically } from '../../src/rules/deterministic-parser.js';
import { resolveRules } from '../../src/rules/resolver.js';

function articleDocument(articleText) {
  const paragraph = {
    innerText: articleText,
    textContent: articleText,
    querySelectorAll: () => []
  };
  const container = {
    innerText: articleText,
    textContent: articleText,
    node: null,
    querySelectorAll: () => [paragraph]
  };
  return {
    querySelector: (selector) => selector === '.content' ? container : null
  };
}

describe('CNIPA public guide adapter', () => {
  it('extracts only the electronic-photo section from a noisy full article', () => {
    const text = '（1）证件照要求：照片尺寸48mm×33mm，头像宽度21mm—24mm。请登录考试系统报名。'
      + '（2）电子件要求：JPG格式，文件大小30KB—120KB，分辨率300dpi，宽：390像素，高：567像素。蓝底，不得严重拉伸。'
      + '登录考试系统后提交材料。';
    const context = getCnipaPageRuleContext(articleDocument(text));
    expect(context).toContain('宽：390像素');
    expect(context).not.toContain('48mm×33mm');
    expect(context).not.toContain('21mm');
    expect(context).not.toContain('登录考试系统');

    const candidates = parseRulesDeterministically({ normalizedText: context });
    const merged = resolveRules(candidates);
    expect(merged.width?.exact).toBe(390);
    expect(merged.height?.exact).toBe(567);
    expect(merged.formats).toEqual(['image/jpeg']);
    expect(merged.minBytes).toBe(30720);
    expect(merged.maxBytes).toBe(120000);
    expect(merged.safetyFlags).not.toContain('PERMISSION_OR_LOGIN');
  });

  it('stops safely when the target section is absent', () => {
    expect(getCnipaPageRuleContext(articleDocument('照片尺寸48mm×33mm，请登录考试系统。'))).toBeNull();
  });

  it('matches only the CNIPA detail route and exact hostname', () => {
    expect(cnipaPublicGuideAdapter.matches(
      `https://${CNIPA_HOST}/home_item_Text_details?nid=6387`
    )).toBe(true);
    expect(cnipaPublicGuideAdapter.matches(
      'https://evil.example/?next=ggfw-dlsks.cnipa.gov.cn/home_item_Text_details'
    )).toBe(false);
    expect(cnipaPublicGuideAdapter.matches(
      `https://${CNIPA_HOST}/home`
    )).toBe(false);
  });
});
