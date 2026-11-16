// 코드 점검 설정. 주로 "정의되지 않은 이름 / 안 쓰는 변수" 같은 실수를 잡는다.
import globals from 'globals';

const common = {
  languageOptions: { ecmaVersion: 2025, sourceType: 'module' },
  rules: {
    'no-undef': 'error',
    'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
    'no-redeclare': 'error',
    'no-dupe-keys': 'error',
    'no-unreachable': 'error',
  },
};

export default [
  { ignores: ['node_modules/**', 'deploy/**'] },
  // 브라우저에서 도는 코드
  { files: ['client/**/*.js', 'studio/**/*.js'], ...common, languageOptions: { ...common.languageOptions, globals: { ...globals.browser } } },
  // 서버와 브라우저가 같이 쓰는 코드: 둘 다에서 동작해야 하므로 전역 객체를 쓰지 않는다
  { files: ['shared/**/*.js'], ...common },
  // 서버, 테스트: Node
  { files: ['server/**/*.js', 'tests/**/*.mjs', 'eslint.config.mjs'], ...common, languageOptions: { ...common.languageOptions, globals: { ...globals.node } } },
  // 테스트 안의 page.evaluate(() => ...) 는 브라우저 안에서 실행되므로 window/document 사용을 허용
  { files: ['tests/browser.test.mjs', 'tests/studio.test.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
];
