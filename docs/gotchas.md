# Gotchas

## body is `flex flex-col` — page containers hebben `w-full` nodig

`app/layout.tsx` geeft de body `flex flex-col`. In een flex-column context zorgt `mx-auto` op een child ervoor dat die child **krimpt naar content-breedte** i.p.v. te stretchen. Dit is onzichtbaar zolang er brede content (lange sessietitels) aanwezig is, maar breekt bij dunne content (collapsed groups, lege states).

**Fix:** altijd `w-full` toevoegen aan de top-level page container:

```tsx
<div className="max-w-5xl w-full mx-auto px-4 py-8">
```

## Tailwind 4 — willekeurige grid-template-columns werken niet betrouwbaar

`grid-cols-[auto_1fr_auto]` genereert de CSS-class mogelijk niet in Tailwind 4 (CSS-first aanpak). Gebruik in plaats daarvan inline `style`:

```tsx
<div
  className="items-center gap-2"
  style={{ display: "grid", gridTemplateColumns: "auto 1fr auto" }}
>
```

Dit bypass Tailwind class-generatie volledig en werkt gegarandeerd.
