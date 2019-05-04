import { Semaphore } from "@alumis/semaphore";
import { o } from "@alumis/observables";
import { disposeNode } from "@alumis/observables-dom";

export abstract class SPA {

    constructor(public indexPage: IDirectoryPage) {

        addEventListener("click", e => {

            let target = <HTMLElement>e.target;

            do {

                if (target.tagName === "A") {

                    if ((<HTMLAnchorElement>target).host !== location.host)
                        return;

                    history.pushState(null, null, (<HTMLAnchorElement>target).href);
                    this.invalidateLocationAsync();
                    e.preventDefault();

                    break;
                }

            } while (target = target.parentElement);
        });

        addEventListener("popstate", e => { this.invalidateLocationAsync(e); });
    }

    private _currentPageNumber: number;
    private _pageNumbers: number;

    async invalidateLocationAsync(e?: PopStateEvent) {

        if (!this._pageNumbers) {

            if (!(this._pageNumbers = <any>sessionStorage.getItem("__pageNumbers")))
                this._pageNumbers = 0;

            else this._pageNumbers = parseInt(<any>this._pageNumbers);
        }

        let state = history.state;

        if (!state)
            state = {};

        if (!state.pageNumber) {

            state.pageNumber = ++this._pageNumbers;
            history.replaceState(state, "");
        }

        sessionStorage.setItem("__pageNumbers", String(this._pageNumbers));

        let oldCurrentPageNumber = this._currentPageNumber;

        this._currentPageNumber = state.pageNumber;

        let pageDirection: PageDirection;

        if (!oldCurrentPageNumber)
            pageDirection = PageDirection.None;

        else if (oldCurrentPageNumber < this._currentPageNumber)
            pageDirection = PageDirection.Forward;

        else if (this._currentPageNumber < oldCurrentPageNumber)
            pageDirection = PageDirection.Backward;

        else pageDirection = PageDirection.None;

        let locationComponents = SPA.getLocationComponents(location.pathname, location.search);

        await this._loadLocationSemaphore.waitOneAsync();

        try {

            await this.indexPage.loadPathAsync(locationComponents.path, locationComponents.args, pageDirection, e);
        }

        finally {

            this._loadLocationSemaphore.release();
        }
    }

    navigateAsync(path: string) {

        history.pushState(null, null, path);
        return this.invalidateLocationAsync();
    }

    private _loadLocationSemaphore = new Semaphore();

    static getLocationComponents(pathname: string, search: string) {

        if (pathname.startsWith("/"))
            pathname = pathname.substr(1);

        if (search.startsWith("?"))
            search = search.substr(1);

        let args: { [name: string]: string } = {};

        if (search) {

            let split = search.split("&");

            for (let a of split) {

                let i = a.indexOf("=");

                if (i === -1)
                    args[decodeURIComponent(a)] = null;

                else {

                    args[decodeURIComponent(a.substr(0, i))] = decodeURIComponent(a.substr(i + 1));
                }
            }
        }

        return { path: pathname.split("/").map(p => decodeURIComponent(p)), args: args };
    }

    dispose() {
    }
}

export interface IPage {

    loadAsync(args: { [name: string]: string }, pageDirection: PageDirection, ev?: PopStateEvent): Promise<void>;
    element: HTMLElement;
    unloadAsync(): Promise<void>;
    title: string;
    dispose();
}

export interface IDirectoryPage extends IPage {

    loadPathAsync(path: string[], args: { [name: string]: string }, pageDirection: PageDirection, ev?: PopStateEvent): Promise<void>;
}

export enum PageDirection {

    None,

    Forward,
    Backward
}

export abstract class DirectoryPage implements IDirectoryPage {

    element: HTMLElement;
    title: string;
    currentPage = o<IPage>(undefined);

    private _aliases = new Map<string, string>();
    private _subPages = new Map<string, { loadInstanceAsync(): Promise<IPage>; cache: boolean; cachedInstance?: IPage; }>();

    protected registerSubPage(paths: string[], loadInstanceAsync: () => Promise<IPage>, cache = true) {

        this._subPages.set(paths[0], { loadInstanceAsync: loadInstanceAsync, cache: cache });

        for (let i = 1; i < paths.length; ++i)
            this._aliases.set(paths[i], paths[0]);
    }

    async loadAsync(args: { [name: string]: string; }, pageDirection: PageDirection, ev?: PopStateEvent) {

        throw new PageNotFoundError();
    }

    async loadPathAsync(path: string[], args: { [name: string]: string }, pageDirection: PageDirection, ev?: PopStateEvent) {

        if (0 < path.length) {

            let subPage = this._subPages.get(path[0]);

            if (!subPage) {

                let alias = this._aliases.get(path[0]);

                if (alias)
                    subPage = this._subPages.get(alias);
            }

            if (subPage) {

                let pageInstance = subPage.cachedInstance;

                if (!pageInstance) {

                    pageInstance = await subPage.loadInstanceAsync();
                    delete subPage.loadInstanceAsync;

                    if (subPage.cache)
                        subPage.cachedInstance = pageInstance;
                }

                let oldPage = this.currentPage.value;

                this.currentPage.value = pageInstance;

                if ((pageInstance as IDirectoryPage).loadPathAsync)
                    await (pageInstance as IDirectoryPage).loadPathAsync(path.slice(1), args, pageDirection);

                else await pageInstance.loadAsync(args, pageDirection);

                if ((oldPage && oldPage.element) !== pageInstance.element)
                    await this.replaceSubPageElementAsync(pageInstance.element, pageDirection);

                if (oldPage && oldPage !== pageInstance)
                    await oldPage.unloadAsync();
            }

            else throw new PageNotFoundError();
        }

        else await this.loadAsync(args, pageDirection, ev);
    }

    protected abstract replaceSubPageElementAsync(element: HTMLElement, pageDirection: PageDirection): Promise<void>;

    async unloadAsync() {

        let currentPage = this.currentPage.value;

        if (currentPage) {

            await currentPage.unloadAsync();
            this.currentPage.value = undefined;
        }

        if (this.element) {

            this.element.remove();
            disposeNode(this.element);
            delete this.element;
        }
    }

    dispose() {

        this.unloadAsync();
    }
}

export class PageNotFoundError extends Error {

}