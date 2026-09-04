# headwind

Lint Tailwind CSS classes from the command line using the official
`@tailwindcss/language-server` diagnostics.

```sh
pnpm install
pnpm build
headwind "src/**/*.{html,tsx,vue}"
```

With no patterns, headwind scans common template, stylesheet, and script file types. It
waits for every matched file to finish before printing one report and setting its exit
code.

```text
src/page.html
  3:16  warning  The class `px-[1rem]` can be written as `px-4`  suggestCanonicalClasses

✖ 1 problem (0 errors, 1 warning)
```

Use `--config` to select a Tailwind v3 configuration file or Tailwind v4 CSS entrypoint.
Use `--quiet`, `--max-warnings`, `--format json`, and `--no-color` in the same way as
other command-line linters. Run `headwind --help` for all options.

Exit code `0` means success, `1` means lint errors or too many warnings, and `2` means a
configuration or runtime failure.
