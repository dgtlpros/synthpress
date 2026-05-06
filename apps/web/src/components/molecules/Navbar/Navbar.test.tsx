import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Navbar } from "./Navbar";

afterEach(cleanup);

describe("Navbar", () => {
  it("renders logo", () => {
    render(<Navbar />);
    expect(screen.getByAltText("SynthPress")).toBeInTheDocument();
  });

  describe("nav links", () => {
    it.each([
      ["Features", "/#features"],
      ["How It Works", "/#how-it-works"],
      ["Pricing", "/pricing"],
    ])("links %s to %s", (label, href) => {
      render(<Navbar />);
      expect(screen.getByText(label).closest("a")).toHaveAttribute("href", href);
    });
  });

  describe("logged out (no user)", () => {
    it("renders Log In link pointing to /login", () => {
      render(<Navbar />);
      const loginLink = screen.getByText("Log In");
      expect(loginLink).toHaveAttribute("href", "/login");
    });

    it("renders Sign Up button pointing to /signup", () => {
      render(<Navbar />);
      const signUpBtn = screen.getByText("Sign Up");
      expect(signUpBtn).toHaveAttribute("href", "/signup");
    });

    it("does not render Account link", () => {
      render(<Navbar />);
      expect(screen.queryByText("Account")).not.toBeInTheDocument();
    });
  });

  describe("logged in (user provided)", () => {
    const user = { email: "test@example.com" };

    it("renders Account link pointing to /dashboard", () => {
      render(<Navbar user={user} />);
      const accountLink = screen.getByText("Account");
      expect(accountLink).toHaveAttribute("href", "/dashboard");
    });

    it("does not render Log In or Sign Up", () => {
      render(<Navbar user={user} />);
      expect(screen.queryByText("Log In")).not.toBeInTheDocument();
      expect(screen.queryByText("Sign Up")).not.toBeInTheDocument();
    });
  });
});
