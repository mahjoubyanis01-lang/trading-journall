import type { CompanionAvatar } from "@task/shared";

export function Avatar({ name, avatar, size }: { name: string; avatar: CompanionAvatar; size?: "lg" | "xl" }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className={`avatar ${size ?? ""} style-${avatar.style}`} style={{ background: avatar.color }} aria-hidden>
      {initial}
    </div>
  );
}
