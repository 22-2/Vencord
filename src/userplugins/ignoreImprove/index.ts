import definePlugin from "@utils/types";

const MODAL_SELECTOR = `[data-app-not-dev-tools] > [class^="layerContainer__"] [data-mana-component="modal"]`;

function debounce(func: Function, delay: number) {
    let timeout: any;
    return function (this: any, ...args: any[]) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

function observeMount(selector: string, onMount: (el: Element) => void, onUnmount: (el: Element) => void, root: Element = document.body) {
    const config = { childList: true, subtree: true };

    const observer = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
            if (mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) {
                        const el = node as Element;
                        if (el.matches(selector)) {
                            onMount(el);
                        }
                        el.querySelectorAll(selector).forEach(onMount);
                    }
                });
            }

            if (mutation.removedNodes.length > 0) {
                mutation.removedNodes.forEach((node) => {
                    if (node.nodeType === 1) {
                        const el = node as Element;
                        if (el.matches(selector)) {
                            onUnmount(el);
                        }
                    }
                });
            }
        }
    });

    observer.observe(root, config);
    root.querySelectorAll(selector).forEach(onMount);

    return observer;
}

function mountAndObserve(selector: string, callback: (el: Element, observer: MutationObserver) => void, root: Element = document.body) {
    const managedObservers = new WeakMap<Element, MutationObserver>();

    const handleMount = (targetEl: Element) => {
        const innerConfig = {
            attributes: true,
            childList: true,
            subtree: true,
            characterData: true,
        };

        const innerObserver = new MutationObserver((mutationsList, observer) => {
            callback(targetEl, observer);
        });

        innerObserver.observe(targetEl, innerConfig);
        managedObservers.set(targetEl, innerObserver);
        callback(targetEl, innerObserver);
    };

    const handleUnmount = (targetEl: Element) => {
        const innerObserver = managedObservers.get(targetEl);
        if (innerObserver) {
            innerObserver.disconnect();
            managedObservers.delete(targetEl);
        }
    };

    return observeMount(selector, handleMount, handleUnmount, root);
}

let observer: MutationObserver | null = null;

const handleMount = debounce((el: Element) => {
    if (!el?.textContent?.includes("あなたが無視設定したユーザーが参加しました")) {
        return;
    }
    const stayBtnEl = Array.from(el.querySelectorAll("button")).find((btn) =>
        btn.textContent?.includes("ここに滞在")
    ) as HTMLElement | undefined;

    if (!stayBtnEl) {
        return;
    }

    stayBtnEl.click();
}, 200);

export default definePlugin({
    name: "IgnoreImprove",
    description: "Automatically clicks 'Stay Here' when 'User you ignored joined' modal appears.",
    authors: [{ name: "momon", id: 0n }],
    start() {
        observer = mountAndObserve(MODAL_SELECTOR, handleMount);
    },
    stop() {
        observer?.disconnect();
        observer = null;
    }
});
