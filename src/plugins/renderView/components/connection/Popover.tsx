/**
 * @file renderView components (connection) — the popover every Mission control popover renders in
 * (spec 09 § M7): one open at a time (`mission.popover`), shown in the browser's top layer so the
 * game frame never covers it, placed under its trigger (`[data-popover-trigger="<id>"]`, right edges
 * aligned, kept inside the window), closed by an outside click and by Esc; Esc and the close key
 * give the focus back to the trigger.
 */
import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { closePopover } from "../../actions/popover";
import { notifyMission } from "../../state";
import type { MissionState, RenderViewCtx } from "../../types";
import { MissionIcon } from "../icons";

/** Gap between the trigger and the popover, px (spec 09 § M15: `top: calc(100% + 10px)`). */
const GAP = 10;

/** Least distance between a popover and the window's edge, px. */
const EDGE = 8;

/**
 * Props of `Popover`.
 */
export type PopoverProps = {
  readonly ctx: RenderViewCtx;
  readonly id: NonNullable<MissionState["popover"]>;
  readonly label: string;
  /** "dialog" (default) or "menu" (the split button's menu). */
  readonly role?: "dialog" | "menu";
  readonly children: ComponentChildren;
};

/**
 * The trigger of a popover, inside the Render workspace.
 *
 * @param element - The popover element.
 * @param id - The popover's id.
 * @returns The trigger; undefined when it is not rendered.
 */
function triggerOf(element: HTMLElement, id: string): HTMLElement | undefined {
  const root = element.closest("[data-render='workspace']") ?? element.ownerDocument;
  return root.querySelector<HTMLElement>(`[data-popover-trigger="${id}"]`) ?? undefined;
}

/**
 * Places the popover under its trigger, right edges aligned, inside the window. A trigger inside a
 * split button anchors on the whole split button (spec 09 § M7: the Connect panel hangs under it).
 *
 * @param element - The popover element.
 * @param trigger - Its trigger.
 */
function place(element: HTMLElement, trigger: HTMLElement | undefined): void {
  if (trigger === undefined) return;
  const rect = (trigger.closest<HTMLElement>("[data-split]") ?? trigger).getBoundingClientRect();
  const width = element.getBoundingClientRect().width;
  const view = element.ownerDocument.defaultView;
  const room = (view?.innerWidth ?? rect.right) - width - EDGE;
  element.style.top = `${Math.round(rect.bottom + GAP)}px`;
  element.style.left = `${Math.round(Math.max(EDGE, Math.min(rect.right - width, room)))}px`;
}

/**
 * Whether a popover element shows in the top layer (false where `:popover-open` is unknown).
 *
 * @param element - The popover element.
 * @returns Whether it is open.
 */
function isOpen(element: HTMLElement): boolean {
  try {
    return element.matches(":popover-open");
  } catch {
    return false;
  }
}

/**
 * Closes the open popover (the Connect panel's scan lease ends with it) and re-renders.
 *
 * @param mission - Mission control's state.
 */
function close(mission: MissionState): void {
  closePopover(mission);
  notifyMission(mission);
}

/**
 * The popover: top layer, placed under its trigger, closed by an outside click or Esc.
 *
 * @param props - ctx, which popover it is, its label, its role and its content.
 * @returns The element.
 */
export function Popover(props: PopoverProps): JSX.Element {
  const { ctx, id, label } = props;
  const { mission } = ctx.state;
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const document = element.ownerDocument;
    const trigger = triggerOf(element, id);
    if (typeof element.showPopover === "function" && !isOpen(element)) {
      element.showPopover();
    }
    place(element, trigger);
    element.focus({ preventScroll: true });

    const onPointer = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Node) || element.contains(target)) return;
      if (trigger?.contains(target) === true) return;
      close(mission);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(mission);
      trigger?.focus();
    };
    const onMove = (): void => place(element, trigger);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onMove, true);
    document.defaultView?.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", onMove, true);
      document.defaultView?.removeEventListener("resize", onMove);
      if (typeof element.hidePopover === "function" && isOpen(element)) {
        element.hidePopover();
      }
    };
  }, [id, mission]);

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is dialog or menu, and both are named by aria-label
    <div
      ref={ref}
      data-popover={id}
      role={props.role ?? "dialog"}
      aria-label={label}
      tabIndex={-1}
      popover="manual"
    >
      {props.children}
    </div>
  );
}

/**
 * Props of `PopoverHead`.
 */
export type PopoverHeadProps = {
  readonly ctx: RenderViewCtx;
  readonly id: NonNullable<MissionState["popover"]>;
  readonly title: string;
  readonly children?: ComponentChildren;
};

/**
 * A popover's header: its title, what follows it, and the close key (focus back to the trigger).
 *
 * @param props - ctx, the popover, its title and the header's extra content.
 * @returns The header.
 */
export function PopoverHead(props: PopoverHeadProps): JSX.Element {
  const { mission } = props.ctx.state;
  const onClose = (event: MouseEvent): void => {
    const element = event.currentTarget;
    const trigger =
      element instanceof HTMLElement
        ? element
            .closest("[data-render='workspace']")
            ?.querySelector<HTMLElement>(`[data-popover-trigger="${props.id}"]`)
        : undefined;
    close(mission);
    trigger?.focus();
  };
  return (
    <header data-part="head">
      <h3>{props.title}</h3>
      {props.children}
      <button
        type="button"
        data-variant="ghost"
        data-size="icon"
        data-action="close"
        aria-label="Close"
        onClick={onClose}
      >
        <MissionIcon name="close" />
      </button>
    </header>
  );
}
