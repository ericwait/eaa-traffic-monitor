import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

// ESLint flat config. Static analysis only — `just lint` never mutates files
// (`just fmt` owns formatting). The prettier config comes LAST so its
// formatting rules win over any stylistic rule from the TS/React presets.
export default tseslint.config(
  {
    // Build/vendor artifacts only — never source. The website/ entries are the
    // MkDocs build output and the uv-managed virtualenv (both gitignored); ESLint
    // flat config does not read .gitignore, so they must be listed here or the
    // docs toolchain's bundled JS floods the lint run.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/.playwright/**',
      'website/site/**',
      'website/.venv/**'
    ]
  },
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  },
  eslintConfigPrettier
)
