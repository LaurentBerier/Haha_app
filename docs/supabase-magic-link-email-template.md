# Supabase Magic Link Email Template (FR + EN)

Use this template for **Supabase Authentication -> Email Templates -> Magic Link**.

Critical rules:

- Keep CTA link based on `{{ .ConfirmationURL }}`
- Do **not** hardcode `{{ .SiteURL }}/auth/callback?...`
- Keep the content bilingual (FR + EN) in a single email

## Recommended Subject

```text
Ha-Ha.ai: Ton lien de connexion / Your sign-in link
```

## HTML Template

```html
<h2>Connexion sécurisée à Ha-Ha.ai</h2>
<p>Salut,</p>
<p>Tu as demandé un lien pour te connecter à ton compte Ha-Ha.ai.</p>
<p>
  <a href="{{ .ConfirmationURL }}">Se connecter maintenant</a>
</p>
<p>Si tu n'as pas demandé ce lien, ignore cet email.</p>
<p>Vérifie aussi ton dossier indésirables/spam si tu ne vois pas nos prochains emails.</p>
<hr />
<h2>Secure sign-in to Ha-Ha.ai</h2>
<p>Hi,</p>
<p>You requested a sign-in link for your Ha-Ha.ai account.</p>
<p>
  <a href="{{ .ConfirmationURL }}">Sign in now</a>
</p>
<p>If you did not request this link, you can safely ignore this email.</p>
<p>Please also check your spam/junk folder for future Ha-Ha.ai emails.</p>
```

## Plain Text Template

```text
Connexion sécurisée à Ha-Ha.ai

Salut,
Tu as demandé un lien pour te connecter à ton compte Ha-Ha.ai.
Se connecter: {{ .ConfirmationURL }}

Si tu n'as pas demandé ce lien, ignore cet email.
Vérifie aussi ton dossier indésirables/spam si tu ne vois pas nos prochains emails.

---

Secure sign-in to Ha-Ha.ai

Hi,
You requested a sign-in link for your Ha-Ha.ai account.
Sign in: {{ .ConfirmationURL }}

If you did not request this link, you can safely ignore this email.
Please also check your spam/junk folder for future Ha-Ha.ai emails.
```

## Validation Checklist

- Magic Link template saved in Supabase dashboard
- Link variable is exactly `{{ .ConfirmationURL }}`
- Received email contains a valid `redirect_to` to `hahaha://auth/callback` (URL-encoded) for native flow
- iOS development build test passes with app closed and app already open
