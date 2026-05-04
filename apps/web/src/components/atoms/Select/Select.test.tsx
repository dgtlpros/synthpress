import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Select } from "./Select";

const options = [
  { value: "fitness", label: "Fitness" },
  { value: "tech", label: "Tech" },
  { value: "pets", label: "Pets" },
];

afterEach(cleanup);

describe("Select", () => {
  it("renders options", () => {
    render(<Select options={options} />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("Fitness")).toBeInTheDocument();
    expect(screen.getByText("Tech")).toBeInTheDocument();
  });

  it("renders placeholder", () => {
    render(<Select options={options} placeholder="Select niche" defaultValue="" />);
    expect(screen.getByText("Select niche")).toBeInTheDocument();
  });

  it("handles change", () => {
    const onChange = vi.fn();
    render(<Select options={options} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "tech" } });
    expect(onChange).toHaveBeenCalled();
  });
});
