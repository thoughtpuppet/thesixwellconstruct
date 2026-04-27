# the six.well construct

Pure static site for `thoughtpuppet/thesixwellconstruct`.

## Hosting

This site is intended to deploy on Cloudflare Pages as a static project.

- Production branch: `main`
- Framework preset: `None`
- Root directory: repository root
- Build command: leave blank
- Build output directory: `/`

Because the site uses root-relative asset and page paths such as `/css/transitions.css`
and `/art/`, it should be deployed at the domain root rather than under a subpath.

## Cloudflare Pages setup

1. Create a new Cloudflare Pages project connected to this repository.
2. Select `main` as the production branch.
3. Set the framework preset to `None`.
4. Leave the root directory at the repository root.
5. Leave the build command empty.
6. Set the build output directory to `/`.

If a Cloudflare setup flow requires a value for the build command, use `exit 0`.

No bundler, package install, or framework build step is required.
