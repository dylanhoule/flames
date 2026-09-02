/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    // Agent worktrees live at .claude/worktrees/ INSIDE this repo, so without
    // this exclusion vitest globs into them and runs other branches' tests as
    // if they were ours. That would silently contaminate review evidence.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
})
