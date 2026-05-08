import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IdeasList } from "./IdeasList";
import type { IdeaCardIdea } from "@/components/molecules/IdeaCard";

afterEach(cleanup);

const sample: IdeaCardIdea[] = [
  {
    id: "i1",
    title: "How to launch a B2B blog",
    status: "generated",
    targetKeyword: "b2b blog",
    executiveSummary: "A practical 30-day plan.",
    articleType: "how_to",
    estimatedWordCount: 1200,
    createdAt: new Date().toISOString(),
  },
  {
    id: "i2",
    title: "5 mistakes teams make",
    status: "approved",
    targetKeyword: "team mistakes",
    executiveSummary: "What to avoid.",
    articleType: "listicle",
    estimatedWordCount: 1000,
    createdAt: new Date().toISOString(),
  },
];

describe("IdeasList", () => {
  it("renders an empty state when no ideas exist and triggers Generate", () => {
    const onGenerate = vi.fn();
    render(<IdeasList ideas={[]} onGenerateClick={onGenerate} />);

    expect(screen.getByText("No ideas yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /generate ideas/i }));
    expect(onGenerate).toHaveBeenCalled();
  });

  it("does not render the header CTA when the list is empty", () => {
    render(<IdeasList ideas={[]} onGenerateClick={vi.fn()} />);
    // Only one Generate ideas button exists (in the empty state).
    expect(
      screen.getAllByRole("button", { name: /generate ideas/i }),
    ).toHaveLength(1);
  });

  it("renders one card per idea + the header CTA when ideas exist", () => {
    const onGenerate = vi.fn();
    render(<IdeasList ideas={sample} onGenerateClick={onGenerate} />);

    expect(screen.getByText("How to launch a B2B blog")).toBeInTheDocument();
    expect(screen.getByText("5 mistakes teams make")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /generate ideas/i }));
    expect(onGenerate).toHaveBeenCalled();
  });

  it("propagates the loading flag to the Generate button", () => {
    render(<IdeasList ideas={sample} onGenerateClick={vi.fn()} isGenerating />);
    const button = screen.getByRole("button", { name: /generate ideas/i });
    expect(button).toBeDisabled();
  });

  it("wraps each idea in a clickable button when onIdeaClick is provided", () => {
    const onIdeaClick = vi.fn();
    render(
      <IdeasList
        ideas={sample}
        onGenerateClick={vi.fn()}
        onIdeaClick={onIdeaClick}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: (name) => name.includes("How to launch a B2B blog"),
      }),
    );
    expect(onIdeaClick).toHaveBeenCalledWith("i1");
  });

  it("does not wrap idea cards in buttons when onIdeaClick is omitted", () => {
    render(<IdeasList ideas={sample} onGenerateClick={vi.fn()} />);

    // The only button rendered should be the header Generate button.
    expect(
      screen.getAllByRole("button", { name: /generate ideas/i }),
    ).toHaveLength(1);
  });

  it("forwards a custom className to the root", () => {
    const { container } = render(
      <IdeasList
        ideas={sample}
        onGenerateClick={vi.fn()}
        className="custom-cls"
      />,
    );
    expect(container.firstChild).toHaveClass("custom-cls");
  });

  it("renders Approve / Reject buttons when handlers are provided", () => {
    render(
      <IdeasList
        ideas={sample}
        onGenerateClick={vi.fn()}
        onApproveIdea={vi.fn()}
        onRejectIdea={vi.fn()}
      />,
    );
    // First card is "generated" → both buttons; second is "approved" → only Reject.
    expect(screen.getAllByRole("button", { name: /approve/i })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /reject/i })).toHaveLength(2);
  });

  it("forwards Approve clicks with the idea id", () => {
    const onApprove = vi.fn();
    render(
      <IdeasList
        ideas={sample}
        onGenerateClick={vi.fn()}
        onApproveIdea={onApprove}
        onRejectIdea={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith("i1");
  });

  it("marks the targeted card as loading and others as 'other' while pending", () => {
    render(
      <IdeasList
        ideas={sample}
        onGenerateClick={vi.fn()}
        onApproveIdea={vi.fn()}
        onRejectIdea={vi.fn()}
        pendingIdeaId="i1"
        pendingIdeaAction="approved"
      />,
    );
    const approve = screen.getByRole("button", { name: /approve/i });
    expect(approve).toHaveAttribute("aria-busy", "true");

    // Both Reject buttons exist (one per card); both should be disabled
    // because something is in flight.
    const rejects = screen.getAllByRole("button", { name: /reject/i });
    rejects.forEach((b) => expect(b).toBeDisabled());
  });

  it("renders the inline error only on the originating card", () => {
    render(
      <IdeasList
        ideas={sample}
        onGenerateClick={vi.fn()}
        onApproveIdea={vi.fn()}
        onRejectIdea={vi.fn()}
        errorIdeaId="i2"
        errorMessage="This idea can't be changed to that status."
      />,
    );
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(/can't be changed/i);
  });

  it("hides Approve / Reject buttons when no handlers are provided", () => {
    render(<IdeasList ideas={sample} onGenerateClick={vi.fn()} />);
    expect(screen.queryAllByRole("button", { name: /approve/i })).toHaveLength(
      0,
    );
    expect(screen.queryAllByRole("button", { name: /reject/i })).toHaveLength(
      0,
    );
  });

  it("renders Generate article only on approved idea cards", () => {
    render(
      <IdeasList
        ideas={sample}
        onGenerateClick={vi.fn()}
        onApproveIdea={vi.fn()}
        onRejectIdea={vi.fn()}
        onGenerateArticleFromIdea={vi.fn()}
      />,
    );
    // sample[1] is the approved idea — exactly one Generate article button.
    expect(
      screen.getAllByRole("button", { name: /generate article/i }),
    ).toHaveLength(1);
  });

  it("forwards Generate article clicks with the idea id", () => {
    const onGenerate = vi.fn();
    render(
      <IdeasList
        ideas={sample}
        onGenerateClick={vi.fn()}
        onApproveIdea={vi.fn()}
        onRejectIdea={vi.fn()}
        onGenerateArticleFromIdea={onGenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /generate article/i }));
    expect(onGenerate).toHaveBeenCalledWith("i2");
  });

  it("propagates a 'generating' pending state to the matching card", () => {
    render(
      <IdeasList
        ideas={sample}
        onGenerateClick={vi.fn()}
        onApproveIdea={vi.fn()}
        onRejectIdea={vi.fn()}
        onGenerateArticleFromIdea={vi.fn()}
        pendingIdeaId="i2"
        pendingIdeaAction="generating"
      />,
    );
    const generate = screen.getByRole("button", {
      name: /generate article/i,
    });
    expect(generate).toHaveAttribute("aria-busy", "true");
  });
});
