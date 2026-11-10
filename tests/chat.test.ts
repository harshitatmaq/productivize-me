import { describe, expect, it } from "vitest";
import { colorOf, personRank, setPeopleColors, whoClass } from "@/lib/chat/colors";
import { parseMentions, segmentMentions } from "@/lib/chat/mentions";
import { parseMessage } from "@/lib/chat/parse";
import { expandEmoji } from "@/lib/chat/emoji";

const names = { u1: "Harshit Kumar", u2: "Ananya Rao", u3: "Sid" };

describe("mentions in a group", () => {
  it("resolves first names, squashed names and @all to user ids", () => {
    expect(parseMentions("@ananya can you check?", names)).toEqual(["u2"]);
    expect(parseMentions("@HarshitKumar and @sid", names).sort()).toEqual(["u1", "u3"]);
    expect(parseMentions("@all dinner?", names).sort()).toEqual(["u1", "u2", "u3"]);
    expect(parseMentions("email me at a@b.com", names)).toEqual([]);
    expect(segmentMentions("hey @sid!", names).map((s) => s.type)).toEqual(["text", "mention", "text"]);
  });
});

describe("identity colours", () => {
  it("maps people to their colour and sorts mine first, then by person", () => {
    setPeopleColors(
      [
        { id: "u1", color: "green", name: "Harshit" },
        { id: "u2", color: "teal", name: "Ananya" },
        { id: "u3", color: null, name: "Sid" },
      ],
      "u1",
    );
    expect(colorOf("u2")).toBe("teal");
    expect(whoClass("u3")).toBe("who-slate"); // no colour yet → neutral
    expect(whoClass("someone-who-left")).toBe("who-slate");
    const ids = ["u3", "u2", "u1"];
    expect([...ids].sort((a, b) => personRank(a, "person").localeCompare(personRank(b, "person")))).toEqual(["u1", "u2", "u3"]);
    expect(personRank("u2", "mine")).toBe(personRank("u3", "mine"));
  });
});

describe("message helpers kept from two-chat", () => {
  it("files save:/work: messages and expands emoji shortcodes", () => {
    expect(parseMessage("save: wifi is hunter2")).toEqual({ kind: "saved", body: "wifi is hunter2" });
    expect(parseMessage("WORK:ship it").kind).toBe("work");
    expect(expandEmoji("nice :fire:")).toBe("nice 🔥");
    expect(expandEmoji("at 12:30:45")).toBe("at 12:30:45");
  });
});
