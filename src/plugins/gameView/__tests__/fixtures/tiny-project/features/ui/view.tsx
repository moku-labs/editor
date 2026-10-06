// The views of the tiny project: a board component, the order cards and the settings popup.
// Read by the project index only.
import { projection } from "../../kit";
import { boardStyle, cardStyle } from "./styles";

export function Board(props: { id: string; children?: unknown }) {
  return (
    <panel key={props.id} style={boardStyle}>
      {props.children}
    </panel>
  );
}

function cardKey(slot: number): string {
  return `card${slot}`;
}

export function Card(props: { slot: number }) {
  const id = cardKey(props.slot);

  return (
    <column
      key={id}
      state={{ selected: props.slot === 0 }}
      style={cardStyle(props.slot)}
    >
      <text key={`${id}Title`} style="ui.title" content="Order" />
    </column>
  );
}

export function Settings() {
  return (
    <screen key="settingsScreen">
      <Board
        id="settingsBoard"
        title="Settings"
      >
        <button key="close" intent="close" />
      </Board>
    </screen>
  );
}

export const cards = projection({
  name: "tiny.cards",
  layer: "ui",
  from: () => [{ id: "cards" }],
  key: row => row.id,
  view: () => (
    <row key="cardRow">
      <Card slot={0} />
      <Card slot={1} />
    </row>
  )
});
