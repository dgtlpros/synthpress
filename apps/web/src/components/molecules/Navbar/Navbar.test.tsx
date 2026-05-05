import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Navbar } from "./Navbar";

afterEach(cleanup);

describe("Navbar", () => {
  it("renders logo", () => {
    render(<Navbar />);
    expect(screen.getByAltText("SynthPress")).toBeInTheDocument();
  });

  it("renders nav links", () => {
    render(<Navbar />);
    expect(screen.getByText("Features")).toBeInTheDocument();
    expect(screen.getByText("How It Works")).toBeInTheDocument();
    expect(screen.getByText("Pricing")).toBeInTheDocument();
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

    it("renders Account link pointing to /account", () => {
      render(<Navbar user={user} />);
      const accountLink = screen.getByText("Account");
      expect(accountLink).toHaveAttribute("href", "/account");
    });

    it("does not render Log In or Sign Up", () => {
      render(<Navbar user={user} />);
      expect(screen.queryByText("Log In")).not.toBeInTheDocument();
      expect(screen.queryByText("Sign Up")).not.toBeInTheDocument();
    });
  });
});
