import { describe, expect, it } from "vitest";
import { AI_MODELS, type AiTask, getModelForTask } from "./models";

describe("AI_MODELS", () => {
  it("defines a non-empty model id for every task", () => {
    for (const [task, model] of Object.entries(AI_MODELS)) {
      expect(model, `model for ${task}`).toBeTruthy();
      expect(typeof model).toBe("string");
    }
  });

  it("uses the cheaper Haiku for idea generation", () => {
    expect(AI_MODELS.ideaGeneration).toMatch(/haiku/i);
  });

  it("uses Sonnet for the long-form writing steps", () => {
    expect(AI_MODELS.outlineGeneration).toMatch(/sonnet/i);
    expect(AI_MODELS.articleGeneration).toMatch(/sonnet/i);
  });
});

describe("getModelForTask", () => {
  const tasks: AiTask[] = [
    "ideaGeneration",
    "outlineGeneration",
    "articleGeneration",
  ];

  it.each(tasks)("returns the configured model for %s", (task) => {
    expect(getModelForTask(task)).toBe(AI_MODELS[task]);
  });
});
