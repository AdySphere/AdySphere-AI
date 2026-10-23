import Link from "next/link";

export function SettingsNav() {
  return (
    <nav className="sub">
      <Link href="/settings">Overview</Link>
      <Link href="/settings/mailboxes">Mailboxes</Link>
      <Link href="/settings/regions">Regions</Link>
      <Link href="/settings/list-types">List types</Link>
      <Link href="/settings/proof-points">Proof points</Link>
      <Link href="/settings/exclusions">Exclusions</Link>
      <Link href="/settings/voice">Voice</Link>
      <Link href="/settings/general">General</Link>
    </nav>
  );
}
