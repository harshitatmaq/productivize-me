import { describe, expect, it } from "vitest";
import { buildGraph, mergeTopicPlan, similarTopics, topicSimilarity, type MapLink, type MergeEntry } from "@/lib/learning-map";

describe("confidence feeds topic strength", () => {
  const base = { id: "e1", title: "Spark costs", entry_date: "2026-11-19", minutes: 90, topics: ["Spark Cost Optimization"] };
  const strength = (confidence: number | null) => buildGraph({ entries: [{ ...base, confidence }], links: [], cards: [], interests: [] }).nodes[0];
  it("a higher rating means a stronger topic, and is shown on the node", () => {
    const low = strength(1);
    const high = strength(5);
    expect(high.strength).toBeGreaterThan(low.strength + 0.3);
    expect(high.confidence).toBe(5);
    expect(strength(null).confidence).toBeNull();
    expect(strength(null).strength).toBeGreaterThan(low.strength);
    expect(strength(null).strength).toBeLessThan(high.strength);
  });
  it("averages ratings across entries", () => {
    const g = buildGraph({ entries: [{ ...base, confidence: 4 }, { ...base, id: "e2", confidence: 2 }], links: [], cards: [], interests: [] });
    expect(g.nodes[0].confidence).toBe(3);
  });
});

describe("similar topics", () => {
  it("treats tuning / performance / optimization as the same word, ignores filler", () => {
    expect(topicSimilarity("Spark Optimization", "Spark Performance Tuning")).toBe(1);
    expect(topicSimilarity("SQL Joins Basics", "SQL Joins")).toBe(1);
    expect(topicSimilarity("Spark Cost Optimization", "Spark Optimization")).toBeCloseTo(0.67, 1);
    expect(topicSimilarity("Kafka Consumer Groups", "Spark Optimization")).toBe(0);
  });
  it("suggests merging the smaller topic into the bigger one", () => {
    const g = buildGraph({
      entries: [
        { id: "a", title: "x", entry_date: "2026-11-01", minutes: 60, topics: ["Spark Optimization"] },
        { id: "b", title: "y", entry_date: "2026-11-02", minutes: 30, topics: ["Spark Optimization"] },
        { id: "c", title: "z", entry_date: "2026-11-03", minutes: 20, topics: ["Spark Performance Tuning"] },
        { id: "d", title: "w", entry_date: "2026-11-03", minutes: 20, topics: ["Kafka Basics"] },
      ],
      links: [],
      cards: [],
      interests: [],
    });
    const [pair] = similarTopics(g.nodes);
    expect(pair.a.label).toBe("Spark Performance Tuning");
    expect(pair.b.label).toBe("Spark Optimization");
    expect(similarTopics(g.nodes)).toHaveLength(1);
  });
});

describe("merging a topic", () => {
  const entries: MergeEntry[] = [
    { id: "e1", topics: ["Spark Performance Tuning", "Partitioning"], connections: [{ kind: "builds_on", topic: "Spark Optimization" }, { kind: "leads_to", topic: "Cost Modeling" }] },
    { id: "e2", topics: ["Spark Optimization"], connections: [{ kind: "leads_to", topic: "Spark Performance Tuning" }] },
    { id: "e3", topics: ["Kafka"], connections: [] },
  ];
  const links: MapLink[] = [
    { from_topic: "Spark Optimization", to_topic: "Spark Performance Tuning", kind: "prereq" },
    { from_topic: "Spark Performance Tuning", to_topic: "Cost Modeling", kind: "prereq" },
    { from_topic: "Spark Optimization", to_topic: "Cost Modeling", kind: "prereq" },
    { from_topic: "Data Formats", to_topic: "spark performance tuning", kind: "prereq" },
  ];
  const plan = mergeTopicPlan(entries, links, "Spark Performance Tuning", "Spark Optimization");

  it("renames the topic in entries and drops links to itself", () => {
    expect(plan.entryUpdates.map((u) => u.id)).toEqual(["e1", "e2"]);
    const e1 = plan.entryUpdates.find((u) => u.id === "e1")!;
    expect(e1.topics).toEqual(["Spark Optimization", "Partitioning"]);
    // "builds on Spark Optimization" would now point at itself → removed.
    expect(e1.connections).toEqual([{ kind: "leads_to", topic: "Cost Modeling" }]);
    expect(plan.entryUpdates.find((u) => u.id === "e2")!.connections).toEqual([]);
  });

  it("moves links to the merged name without duplicates or self-links", () => {
    expect(plan.linkDeletes).toHaveLength(3);
    // Optimization→Tuning becomes a self-link (dropped); Tuning→Cost duplicates Optimization→Cost (dropped).
    expect(plan.linkInserts).toEqual([{ from_topic: "Data Formats", to_topic: "Spark Optimization", kind: "prereq" }]);
  });

  it("leaves unrelated entries and links alone", () => {
    expect(plan.entryUpdates.some((u) => u.id === "e3")).toBe(false);
    expect(plan.linkDeletes.some((l) => l.from_topic === "Spark Optimization" && l.to_topic === "Cost Modeling")).toBe(false);
  });
});
