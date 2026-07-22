// vitest.config.ts
import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Worktrees do git vivem em .claude/worktrees/ e são checkouts completos:
    // sem excluí-las, a suíte rodada da raiz executa também os testes de OUTRAS
    // branches, inflando a contagem e medindo código que não é o desta árvore.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
