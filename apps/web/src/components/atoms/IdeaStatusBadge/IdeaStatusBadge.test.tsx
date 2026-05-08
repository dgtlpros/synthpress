import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  IDEA_STATUSES,
  IdeaStatusBadge,
  getIdeaStatusLabel,
  type IdeaStatus,
} from "./IdeaStatusBadge";

afterEach(cleanup);

describe("IdeaStatusBadge", () => {
  it.each(IDEA_STATUSES)("renders the readable label for %s", (status) => {
    render(<IdeaStatusBadge status={status} />);
    expect(screen.getByText(getIdeaStatusLabel(status))).toBeInTheDocument();
  });

  it("forwards a custom className", () => {
    const { container } = render(
      <IdeaStatusBadge status="generated" className="custom-cls" />,
    );
    expect(container.firstChild).toHaveClass("custom-cls");
  });

  it("accepts a custom size", () => {
    render(<IdeaStatusBadge status="approved" size="md" />);
    expect(
      screen.getByText(getIdeaStatusLabel("approved")),
    ).toBeInTheDocument();
  });
});

describe("IDEA_STATUSES", () => {
  it("matches the DB check-constraint values", () => {
    const expected: IdeaStatus[] = [
      "generated",
      "approved",
      "rejected",
      "converted_to_article",
    ];
    expect([...IDEA_STATUSES]).toEqual(expected);
  });
});
