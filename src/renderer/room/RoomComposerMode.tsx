import {t} from '../i18n';
import type { RoomController } from "./use-room-controller";
export function RoomComposerMode({ controller }: { controller: RoomController }) {
  const { room, state, mode, setMode, discussion, handRaise, setHandRaise, hostPick, setHostPick, stopping, composer, participants, personal } = controller;
  return (
    <>
      {!personal && (
        <div className="composer-mode">
          <div className="segmented" role="radiogroup" aria-label={t("聊天方式")}>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "chat"}
              className={mode === "chat" ? "selected" : ""}
              disabled={state.active || stopping}
              onClick={() => setMode("chat")}
              title={t("大家自由接话，遵守本条消息的每人发言次数上限，可随时终止")}
            >
              {t("闲聊")}</button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "meeting"}
              className={mode === "meeting" ? "selected" : ""}
              disabled={state.active || stopping}
              onClick={() => setMode("meeting")}
              title={t("按在场顺序轮流回答，遵守本条消息的每人发言次数上限，可随时终止")}
            >
              {t("开会")}</button>
          </div>
          {mode === "meeting" && (
            <>
              <label className="room-hand-option" title={t("一轮回答后举手，每人最多补充一次，没人举手后等你。单人会议不需要举手。举手也计入调用次数。")}>
                <input
                  type="checkbox"
                  checked={handRaise && participants.length > 1}
                  disabled={participants.length < 2 || state.active || discussion?.phase === "awaiting-host"}
                  onChange={(e) => {
                    setHandRaise(e.target.checked);
                    if (e.target.checked) setHostPick(true);
                  }}
                />
                {t("举手模式")}</label>
              {handRaise && (
                <label className="room-hand-option">
                  <input type="checkbox" checked={hostPick} disabled={state.active || discussion?.phase === "awaiting-host"} onChange={(e) => setHostPick(e.target.checked)} />
                  {t("举手后由我点名")}</label>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
