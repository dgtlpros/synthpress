/**
 * SynthPress connector — admin page interactions.
 *
 * Single responsibility: copy the connection-package JSON to the
 * clipboard when the user clicks the "Copy connection package"
 * button. No remote requests, no third-party libraries, no
 * dependencies on jQuery — vanilla DOM so the script enqueues with
 * no `deps` array.
 */
(function () {
    "use strict";

    function ready(fn) {
        if (document.readyState !== "loading") {
            fn();
        } else {
            document.addEventListener("DOMContentLoaded", fn);
        }
    }

    function setFeedback(node, message) {
        if (!node) return;
        node.textContent = message;
    }

    function clearFeedbackLater(node, delayMs) {
        if (!node) return;
        window.setTimeout(function () {
            node.textContent = "";
        }, delayMs);
    }

    /**
     * Copy via the modern Clipboard API when available, otherwise
     * fall back to selecting the textarea + execCommand("copy").
     * Returns a promise-like with then()/catch() so callers can
     * branch on success.
     */
    function copyText(text, fallbackEl) {
        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            return navigator.clipboard.writeText(text);
        }
        return new Promise(function (resolve, reject) {
            try {
                if (!fallbackEl) {
                    reject(new Error("no fallback element"));
                    return;
                }
                fallbackEl.focus();
                fallbackEl.select();
                var ok = document.execCommand("copy");
                if (ok) {
                    resolve();
                } else {
                    reject(new Error("execCommand copy returned false"));
                }
            } catch (err) {
                reject(err);
            }
        });
    }

    ready(function () {
        var button = document.getElementById("synthpress-copy-package");
        if (!button) return;

        var targetId = button.getAttribute("data-copy-target") || "synthpress-connection-package";
        var target = document.getElementById(targetId);
        var feedback = document.getElementById("synthpress-copy-feedback");
        var defaultLabel = button.getAttribute("data-copy-label") || button.textContent;
        var copiedLabel = button.getAttribute("data-copied-label") || "Copied!";

        button.addEventListener("click", function () {
            if (!target) {
                setFeedback(feedback, "Could not find connection package.");
                return;
            }
            var text = target.value || "";
            copyText(text, target).then(
                function () {
                    button.textContent = copiedLabel;
                    setFeedback(feedback, copiedLabel);
                    window.setTimeout(function () {
                        button.textContent = defaultLabel;
                    }, 1500);
                    clearFeedbackLater(feedback, 1500);
                },
                function () {
                    setFeedback(
                        feedback,
                        "Could not copy automatically — select the text and use ⌘C / Ctrl+C."
                    );
                    clearFeedbackLater(feedback, 4000);
                }
            );
        });
    });
})();
