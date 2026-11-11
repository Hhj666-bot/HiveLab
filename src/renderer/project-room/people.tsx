import {t} from '../i18n';
import {type ReactNode} from "react";
import {Avatar, useTeam} from "../members";
export function MemberName({ id }: { id: string }) {
  const member = useTeam().get(id);
  return <span className={`flow-member member-${id}`}>{member && <Avatar member={member} size={18} ring={false} />}{member?.name ?? t("成员")}</span>;
}

export function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) { return <div className="meeting-note">{icon}<div>{children}</div></div>; }

export function MemberLine({ id, label, children }: { id: string; label?: ReactNode; children: ReactNode }) {
  const member = useTeam().get(id);
  return <div className={`meeting-line member-${id}`}>{member && <Avatar member={member} size={32} />}<div className="meeting-line-body"><span className="meeting-line-name"><strong>{member?.name ?? t("成员")}</strong>{label}</span>{children}</div></div>;
}
