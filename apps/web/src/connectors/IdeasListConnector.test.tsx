import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

vi.mock("@/hooks/useGenerateIdeas", () => ({
  useGenerateIdeas: vi.fn(),
}));

vi.mock("@/hooks/useIdeaActions", () => ({
  useIdeaActions: vi.fn(),
}));

vi.mock("@/hooks/useGenerateArticleFromIdea", () => ({
  useGenerateArticleFromIdea: vi.fn(),
}));

afterEach(cleanup);

/**
 * The modal's <dialog> always mounts (only its `open` attribute toggles),
 * so multiple "Generate ideas" buttons coexist in the DOM. These helpers
 * scope queries to the right region so getByRole stays unambiguous.
 */
function getDialog(): HTMLElement {
  const byRole = screen.queryByRole("dialog");
  if (byRole) return byRole as HTMLElement;
  const dialog = document.querySelector("dialog");
  if (!dialog) throw new Error("modal dialog not in DOM");
  return dialog as HTMLElement;
}

function clickEmptyStateGenerate(): void {
  // The empty-state Generate button lives outside the dialog. Find by
  // walking the DOM rather than the role lookup that grabs both.
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).filter(
    (b) =>
      /generate ideas/i.test(b.textContent ?? "") && !getDialog().contains(b),
  );
  if (buttons.length === 0) {
    throw new Error("no empty-state Generate ideas button");
  }
  fireEvent.click(buttons[0]!);
}

function clickHeaderGenerate(): void {
  // When ideas exist, the Generate button lives in the dashboard
  // header. Same find-outside-dialog pattern; just a different
  // matching string (the modal's submit button now says "Generate N
  // ideas" so the bare "Generate ideas" search wouldn't disambiguate).
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).filter(
    (b) =>
      b.textContent?.trim() === "Generate ideas" && !getDialog().contains(b),
  );
  if (buttons.length === 0) {
    throw new Error("no header Generate ideas button");
  }
  fireEvent.click(buttons[0]!);
}

function clickModalSubmit(): void {
  const dialog = getDialog();
  // The submit button label is now dynamic: "Generate 5 ideas" /
  // "Generate 10 ideas" / "Generate 1 idea" depending on count.
  const submit = within(dialog)
    .getAllByRole("button", { hidden: true })
    .find(
      (b) =>
        /^Generate \d+ idea/i.test(b.textContent?.trim() ?? "") &&
        b.getAttribute("type") === "submit",
    );
  if (!submit) throw new Error("no modal submit button");
  fireEvent.click(submit);
}

function clickModalCancel(): void {
  const dialog = getDialog();
  fireEvent.click(
    within(dialog).getByRole("button", { name: /cancel/i, hidden: true }),
  );
}

import { useGenerateArticleFromIdea } from "@/hooks/useGenerateArticleFromIdea";
import { useGenerateIdeas } from "@/hooks/useGenerateIdeas";
import { useIdeaActions } from "@/hooks/useIdeaActions";
import { IdeasListConnector } from "./IdeasListConnector";

const mockedUseGenerateIdeas = vi.mocked(useGenerateIdeas);
const mockedUseIdeaActions = vi.mocked(useIdeaActions);
const mockedUseGenerateArticleFromIdea = vi.mocked(useGenerateArticleFromIdea);

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(
      this: HTMLDialogElement,
    ) {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(
      this: HTMLDialogElement,
    ) {
      this.removeAttribute("open");
    };
  }
});

const baseProps = {
  teamId: "t1",
  projectId: "p1",
  blogId: "b1",
  initialIdeas: [],
  defaultCount: 5,
  creditsCost: 1,
};

const generate = vi.fn();
const resetError = vi.fn();
const approve = vi.fn();
const reject = vi.fn();
const archive = vi.fn();
const unarchive = vi.fn();
const resetIdeaError = vi.fn();
const generateArticle = vi.fn();
const resetGenerationError = vi.fn();

function defaultIdeaActions(
  overrides: Partial<ReturnType<typeof useIdeaActions>> = {},
): ReturnType<typeof useIdeaActions> {
  return {
    approve,
    reject,
    archive,
    unarchive,
    pendingIdeaId: null,
    pendingAction: null,
    pendingStatus: null,
    errorIdeaId: null,
    errorMessage: null,
    resetError: resetIdeaError,
    ...overrides,
  };
}

function defaultGenerateArticleHook(
  overrides: Partial<ReturnType<typeof useGenerateArticleFromIdea>> = {},
): ReturnType<typeof useGenerateArticleFromIdea> {
  return {
    generate: generateArticle,
    pendingIdeaId: null,
    errorIdeaId: null,
    errorMessage: null,
    lastResult: null,
    resetError: resetGenerationError,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseGenerateIdeas.mockReturnValue({
    generate,
    isGenerating: false,
    generateError: null,
    lastResult: null,
    resetError,
  });
  mockedUseIdeaActions.mockReturnValue(defaultIdeaActions());
  mockedUseGenerateArticleFromIdea.mockReturnValue(
    defaultGenerateArticleHook(),
  );
});

describe("IdeasListConnector", () => {
  it("opens the modal when Generate is clicked from the empty state", () => {
    render(<IdeasListConnector {...baseProps} />);

    clickEmptyStateGenerate();
    // The static title is the new copy.
    expect(screen.getByText("Generate article ideas")).toBeVisible();
  });

  it("submits the brief + count to the hook", () => {
    render(<IdeasListConnector {...baseProps} defaultCount={5} />);

    clickEmptyStateGenerate();
    fireEvent.change(screen.getByLabelText(/topic or brief/i), {
      target: { value: "ai agents" },
    });
    clickModalSubmit();

    expect(generate).toHaveBeenCalledWith({ brief: "ai agents", count: 5 });
  });

  it("submits with undefined brief when the textarea is empty", () => {
    render(<IdeasListConnector {...baseProps} defaultCount={5} />);

    clickEmptyStateGenerate();
    clickModalSubmit();

    expect(generate).toHaveBeenCalledWith({ brief: undefined, count: 5 });
  });

  it("submits the picked preset count when a chip is clicked", () => {
    render(<IdeasListConnector {...baseProps} defaultCount={5} />);

    clickEmptyStateGenerate();
    fireEvent.click(
      within(getDialog()).getByRole("radio", { name: "10", hidden: true }),
    );
    clickModalSubmit();

    expect(generate).toHaveBeenCalledWith({ brief: undefined, count: 10 });
  });

  it("propagates the loading flag + error from the hook", () => {
    mockedUseGenerateIdeas.mockReturnValue({
      generate,
      isGenerating: true,
      generateError: "Not enough synth tokens",
      lastResult: null,
      resetError,
    });

    render(<IdeasListConnector {...baseProps} />);
    clickEmptyStateGenerate();

    const dialog = getDialog();
    expect(
      within(dialog).getByRole("alert", { hidden: true }),
    ).toHaveTextContent(/not enough synth/i);
    expect(
      within(dialog).getByRole("button", { name: /cancel/i, hidden: true }),
    ).toBeDisabled();
  });

  it("does not close the modal or clear the error while generating", () => {
    mockedUseGenerateIdeas.mockReturnValue({
      generate,
      isGenerating: true,
      generateError: null,
      lastResult: null,
      resetError,
    });

    render(<IdeasListConnector {...baseProps} />);
    clickEmptyStateGenerate();
    clickModalCancel();

    expect(resetError).not.toHaveBeenCalled();
  });

  it("closes the modal + resets the error when Cancel is clicked outside generating", () => {
    render(<IdeasListConnector {...baseProps} />);
    clickEmptyStateGenerate();
    clickModalCancel();

    expect(resetError).toHaveBeenCalled();
  });

  it("clears the brief + resets the count via onSuccess after a successful generation", () => {
    let capturedOnSuccess: (() => void) | undefined;
    mockedUseGenerateIdeas.mockImplementation(({ onSuccess }) => {
      capturedOnSuccess = onSuccess as (() => void) | undefined;
      return {
        generate,
        isGenerating: false,
        generateError: null,
        lastResult: null,
        resetError,
      };
    });

    render(<IdeasListConnector {...baseProps} defaultCount={5} />);
    clickEmptyStateGenerate();
    fireEvent.change(screen.getByLabelText(/topic or brief/i), {
      target: { value: "x" },
    });
    // Bump count off the default so we can prove it resets.
    fireEvent.click(
      within(getDialog()).getByRole("radio", { name: "10", hidden: true }),
    );

    capturedOnSuccess?.();

    clickEmptyStateGenerate();
    expect(
      (screen.getByLabelText(/topic or brief/i) as HTMLTextAreaElement).value,
    ).toBe("");
    // Count default is restored — the "5" preset is checked.
    expect(
      within(getDialog()).getByRole("radio", { name: "5", hidden: true }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("renders the supplied initialIdeas + creditsCost", () => {
    render(
      <IdeasListConnector
        {...baseProps}
        initialIdeas={[
          {
            id: "i1",
            title: "Existing idea",
            status: "generated",
            targetKeyword: null,
            executiveSummary: null,
            articleType: null,
            estimatedWordCount: null,
            createdAt: new Date().toISOString(),
          },
        ]}
        creditsCost={3}
      />,
    );

    expect(screen.getByText("Existing idea")).toBeInTheDocument();
    clickHeaderGenerate();
    const para = screen.getByText(/This will use/i);
    expect(para).toHaveTextContent("3 synth tokens");
  });

  it("forwards Approve clicks to the useIdeaActions hook", () => {
    render(
      <IdeasListConnector
        {...baseProps}
        initialIdeas={[
          {
            id: "i1",
            title: "Idea 1",
            status: "generated",
            targetKeyword: null,
            executiveSummary: null,
            articleType: null,
            estimatedWordCount: null,
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(approve).toHaveBeenCalledWith("i1");
  });

  it("forwards Reject clicks to the useIdeaActions hook", () => {
    render(
      <IdeasListConnector
        {...baseProps}
        initialIdeas={[
          {
            id: "i1",
            title: "Idea 1",
            status: "generated",
            targetKeyword: null,
            executiveSummary: null,
            articleType: null,
            estimatedWordCount: null,
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(reject).toHaveBeenCalledWith("i1");
  });

  it("forwards Archive clicks to the useIdeaActions hook", () => {
    render(
      <IdeasListConnector
        {...baseProps}
        initialIdeas={[
          {
            id: "i1",
            title: "Idea 1",
            status: "generated",
            targetKeyword: null,
            executiveSummary: null,
            articleType: null,
            estimatedWordCount: null,
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^archive$/i }));
    expect(archive).toHaveBeenCalledWith("i1");
  });

  it("forwards Unarchive clicks to the useIdeaActions hook", () => {
    render(
      <IdeasListConnector
        {...baseProps}
        initialIdeas={[
          {
            id: "i1",
            title: "Archived idea",
            status: "generated",
            targetKeyword: null,
            executiveSummary: null,
            articleType: null,
            estimatedWordCount: null,
            createdAt: new Date().toISOString(),
            isArchived: true,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /archived/i }));
    fireEvent.click(screen.getByRole("button", { name: /^unarchive$/i }));
    expect(unarchive).toHaveBeenCalledWith("i1");
  });

  it("propagates the pending state from useIdeaActions to the matching card", () => {
    mockedUseIdeaActions.mockReturnValueOnce(
      defaultIdeaActions({
        pendingIdeaId: "i1",
        pendingAction: "approved",
        pendingStatus: "approved",
      }),
    );

    render(
      <IdeasListConnector
        {...baseProps}
        initialIdeas={[
          {
            id: "i1",
            title: "Idea 1",
            status: "generated",
            targetKeyword: null,
            executiveSummary: null,
            articleType: null,
            estimatedWordCount: null,
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    const approveBtn = screen.getByRole("button", { name: /approve/i });
    expect(approveBtn).toHaveAttribute("aria-busy", "true");
  });

  it("propagates an archive pending state to the matching card", () => {
    mockedUseIdeaActions.mockReturnValueOnce(
      defaultIdeaActions({
        pendingIdeaId: "i1",
        pendingAction: "archiving",
      }),
    );

    render(
      <IdeasListConnector
        {...baseProps}
        initialIdeas={[
          {
            id: "i1",
            title: "Idea 1",
            status: "generated",
            targetKeyword: null,
            executiveSummary: null,
            articleType: null,
            estimatedWordCount: null,
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    const archiveBtn = screen.getByRole("button", { name: /^archive$/i });
    expect(archiveBtn).toHaveAttribute("aria-busy", "true");
  });

  it("renders the inline error from useIdeaActions on the failing card", () => {
    mockedUseIdeaActions.mockReturnValueOnce(
      defaultIdeaActions({
        errorIdeaId: "i1",
        errorMessage: "This idea can't be changed to that status.",
      }),
    );

    render(
      <IdeasListConnector
        {...baseProps}
        initialIdeas={[
          {
            id: "i1",
            title: "Idea 1",
            status: "approved",
            targetKeyword: null,
            executiveSummary: null,
            articleType: null,
            estimatedWordCount: null,
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    // Approved card lives in the Approved tab — switch to see it.
    fireEvent.click(screen.getByRole("tab", { name: /^approved/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/can't be changed/i);
  });

  it("forwards Generate article clicks to the useGenerateArticleFromIdea hook", () => {
    render(
      <IdeasListConnector
        {...baseProps}
        initialIdeas={[
          {
            id: "i1",
            title: "Approved idea",
            status: "approved",
            targetKeyword: null,
            executiveSummary: null,
            articleType: null,
            estimatedWordCount: null,
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /^approved/i }));
    fireEvent.click(screen.getByRole("button", { name: /generate article/i }));
    expect(generateArticle).toHaveBeenCalledWith("i1");
  });

  it("propagates a 'generating' pending state when the generation hook is in flight", () => {
    mockedUseGenerateArticleFromIdea.mockReturnValueOnce(
      defaultGenerateArticleHook({ pendingIdeaId: "i1" }),
    );

    render(
      <IdeasListConnector
        {...baseProps}
        initialIdeas={[
          {
            id: "i1",
            title: "Approved idea",
            status: "approved",
            targetKeyword: null,
            executiveSummary: null,
            articleType: null,
            estimatedWordCount: null,
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /^approved/i }));
    const generateBtn = screen.getByRole("button", {
      name: /generate article/i,
    });
    expect(generateBtn).toHaveAttribute("aria-busy", "true");
  });

  it("renders the generation hook's error on the failing card", () => {
    mockedUseGenerateArticleFromIdea.mockReturnValueOnce(
      defaultGenerateArticleHook({
        errorIdeaId: "i1",
        errorMessage: "Not enough synth tokens",
      }),
    );

    render(
      <IdeasListConnector
        {...baseProps}
        initialIdeas={[
          {
            id: "i1",
            title: "Approved idea",
            status: "approved",
            targetKeyword: null,
            executiveSummary: null,
            articleType: null,
            estimatedWordCount: null,
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /^approved/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/synth tokens/i);
  });

  it("prefers the actions hook's error when both hooks are reporting errors on the same card", () => {
    mockedUseIdeaActions.mockReturnValueOnce(
      defaultIdeaActions({
        errorIdeaId: "i1",
        errorMessage: "actions error",
      }),
    );
    mockedUseGenerateArticleFromIdea.mockReturnValueOnce(
      defaultGenerateArticleHook({
        errorIdeaId: "i1",
        errorMessage: "generation error",
      }),
    );

    render(
      <IdeasListConnector
        {...baseProps}
        initialIdeas={[
          {
            id: "i1",
            title: "Approved idea",
            status: "approved",
            targetKeyword: null,
            executiveSummary: null,
            articleType: null,
            estimatedWordCount: null,
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /^approved/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("actions error");
  });
});
