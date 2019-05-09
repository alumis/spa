import { Semaphore } from "@alumis/semaphore";
import { o } from "@alumis/observables";
import { disposeNode, Component } from "@alumis/observables-dom";
import { CancellationToken } from "@alumis/cancellationtoken";

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

    static getLocationComponents(pathName: string, search: string) {

        if (pathName.startsWith("/"))
            pathName = pathName.substr(1);

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

        return { path: pathName ? pathName.split("/").map(p => decodeURIComponent(p)) : [], args: args };
    }

    dispose() {
    }
}

export interface IPage {

    loadAsync(args: { [name: string]: string }, pageDirection: PageDirection, ev?: PopStateEvent): Promise<void>;
    node: HTMLElement;
    unload();
    title: string;
}

export interface IDirectoryPage extends IPage {

    loadPathAsync(path: string[], args: { [name: string]: string }, pageDirection: PageDirection, ev?: PopStateEvent): Promise<void>;
}

export enum PageDirection {

    None,

    Forward,
    Backward
}

export type Page = IPage & Component<HTMLElement>;

export abstract class DirectoryPage<THTMLElement extends HTMLElement> extends Component<THTMLElement> implements IDirectoryPage {

    node: THTMLElement;
    title: string;
    currentPage = o<Page>(undefined);

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

            let subPageEntry = this._subPages.get(path[0]);

            if (!subPageEntry) {

                let alias = this._aliases.get(path[0]);

                if (alias)
                    subPageEntry = this._subPages.get(alias);
            }

            if (subPageEntry) {

                let newPage = subPageEntry.cachedInstance;

                if (!newPage) {

                    newPage = await subPageEntry.loadInstanceAsync();

                    if (subPageEntry.cache) {

                        subPageEntry.cachedInstance = newPage;
                        delete subPageEntry.loadInstanceAsync;
                    }
                }

                let oldPage = this.currentPage.value;

                if ((newPage as IDirectoryPage).loadPathAsync)
                    await (newPage as IDirectoryPage).loadPathAsync(path.slice(1), args, pageDirection);

                else await newPage.loadAsync(args, pageDirection);

                this.currentPage.value = newPage;
                
                if (oldPage && oldPage !== newPage)
                    await oldPage.unload();
            }

            else throw new PageNotFoundError();
        }

        else await this.loadAsync(args, pageDirection, ev);
    }

    unload() {

        let currentPage = this.currentPage.value;

        if (currentPage) {

            currentPage.unload();
            this.currentPage.value = undefined;
        }

        if (this.node) {

            this.node.remove();
            disposeNode(this.node);
            delete this.node;
        }
    }
}

export class PageNotFoundError extends Error {

}