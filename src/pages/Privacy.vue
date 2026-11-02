<script setup>
	import Title from '../assets/Title.vue'
</script>

<template>
	<div class="page-layout">
		<Title/>

		<div class="privacy">
			<div class="board-strip" aria-hidden="true"></div>

			<header class="site-header">
				<div class="wrap">
					<h1>Privacy Policy</h1>
					<p class="updated">Last updated: November 2, 2026</p>
				</div>
			</header>

			<main class="wrap">
				<p class="intro">Chesserly is a chess analysis app. This policy explains what information we collect, how we use it, and your choices.</p>

				<nav class="toc" aria-labelledby="toc-title">
					<h2 id="toc-title">On this page</h2>
					<ol>
						<li><a href="#who">Who we are</a></li>
						<li><a href="#collect">Information we collect</a></li>
						<li><a href="#device">Information stored on your device</a></li>
						<li><a href="#analytics">Analytics</a></li>
						<li><a href="#use">How we use information</a></li>
						<li><a href="#third-parties">Third-party services</a></li>
						<li><a href="#transfers">International transfers</a></li>
						<li><a href="#sharing">Sharing your information</a></li>
						<li><a href="#security">Security</a></li>
						<li><a href="#rights">Your choices and rights</a></li>
						<li><a href="#retention">Data retention</a></li>
						<li><a href="#children">Children</a></li>
						<li><a href="#changes">Changes to this policy</a></li>
						<li><a href="#contact">Contact us</a></li>
					</ol>
				</nav>

				<section id="who">
					<h2>1. Who we are</h2>
					<p>Chesserly is operated by an individual developer based in Georgia. We are the controller of the personal data described in this policy. You can reach us at <a href="mailto:chesserlyapp@gmail.com">chesserlyapp@gmail.com</a>.</p>
				</section>

				<section id="collect">
					<h2>2. Information we collect</h2>
					<p><strong>Account information (if you sign up):</strong> your email address and password. Login is handled by Firebase Authentication (Google). We never see or store your password in readable form.</p>
					<p><strong>Saved games:</strong> when you are logged in and click Analyse, the game is automatically saved to your library. This includes the moves, the player usernames (including your opponent's), ratings, time control and date. You can delete saved games at any time from your library.</p>
					<p><strong>Chess data you choose to import:</strong> when you enter a Chess.com or Lichess username, your browser requests that player's public games directly from those services. They receive your IP address and the username you typed. You can also paste a PGN or FEN, which is processed in your browser and only saved if you are logged in and analyse it.</p>
					<p><strong>Technical data:</strong> like most websites, our hosting provider (Cloudflare) and our backend provider (Firebase, Google) may record your IP address and basic request information for security and reliability.</p>
					<p><strong>Analytics data:</strong> see the Analytics section below.</p>
				</section>

				<section id="device">
					<h2>3. Information stored on your device</h2>
					<p>Chesserly stores some data in your browser's local storage, such as cached analysis results, your display preferences and the username you last entered. This data stays on your device and isn't sent to us.</p>
					<p>If you log in, Firebase Authentication also keeps a login session in your browser's storage so you stay signed in. This is essential for the app to work. Google Analytics, if enabled, sets cookies as described below. We don't use advertising cookies.</p>
				</section>

				<section id="analytics">
					<h2>4. Analytics</h2>
					<p>We use one analytics tool to understand how the app is used and to improve it:</p>
					<ul>
						<li><strong>Umami:</strong> a privacy-focused analytics tool. It doesn't use cookies and doesn't track you across websites. It records things like pages visited, referrer, browser, operating system, device type and approximate country.</li>
				</section>

				<section id="use">
					<h2>5. How we use information</h2>
					<ul>
						<li>To provide the app and let you log in and access your saved games (to perform our service to you)</li>
						<li>To keep the service secure and working (our legitimate interest)</li>
						<li>To understand usage and improve the app using Umami (our legitimate interest)</li>
						<li>To measure usage with Google Analytics (with your consent, where required)</li>
						<li>To respond to your requests and comply with the law</li>
					</ul>
				</section>

				<section id="third-parties">
					<h2>6. Third-party services</h2>
					<ul>
						<li><strong>Lichess:</strong> we send position data to the Lichess API to get cloud evaluations and opening information. When you import games, your browser also requests public game data from Lichess. Lichess has its own privacy policy.</li>
						<li><strong>Chess.com:</strong> when you import games, your browser requests public game data from Chess.com. Chess.com has its own privacy policy.</li>
						<li><strong>Firebase (Google):</strong> manages account login and stores your saved games.</li>
						<li><strong>Cloudflare:</strong> hosts the app and delivers it to you.</li>
						<li><strong>Google Fonts:</strong> loads the fonts used in the app, which means your browser contacts Google's servers.</li>
						<li><strong>Umami and Google Analytics:</strong> analytics, as described above.</li>
					</ul>
				</section>

				<section id="transfers">
					<h2>7. International transfers</h2>
					<p>Our providers, including Google and Cloudflare, process data in the United States and other countries. Where required, these transfers rely on safeguards such as the EU–US Data Privacy Framework or standard contractual clauses.</p>
				</section>

				<section id="sharing">
					<h2>8. Sharing your information</h2>
					<p>We don't sell your personal information. We share it only with the service providers listed above, or if required by law.</p>
				</section>

				<section id="security">
					<h2>9. Security</h2>
					<p>Data is transmitted over HTTPS, and your saved games are protected by account-based access rules so that only you can read them. No system is perfectly secure, but we take reasonable steps to protect your information.</p>
				</section>

				<section id="rights">
					<h2>10. Your choices and rights</h2>
					<p>You can:</p>
					<ul>
						<li>Access the information we hold about you</li>
						<li>Correct your account information</li>
						<li>Delete your account and saved data</li>
						<li>Receive a copy of your data</li>
						<li>Object to or restrict certain processing, and withdraw consent where we rely on it</li>
					</ul>
					<p>You can delete individual saved games yourself in the app. For anything else, including deleting your account, email us at <a href="mailto:chesserlyapp@gmail.com">chesserlyapp@gmail.com</a>.</p>
					<p>You also have the right to complain to your local data protection authority. In Georgia this is the Personal Data Protection Service, and in the EU or UK it is the authority in your country.</p>
				</section>

				<section id="retention">
					<h2>11. Data retention</h2>
					<p>We keep account data and saved games while your account is active. When you delete your account, we delete your personal data within 30 days, except where the law requires us to keep it. Analytics data is kept according to the retention settings of each analytics tool.</p>
				</section>

				<section id="children">
					<h2>12. Children</h2>
					<p>Chesserly isn't directed at children under 13 (or under 16 where local law sets a higher age). If you believe a child has given us personal information, contact us so we can delete it.</p>
				</section>

				<section id="changes">
					<h2>13. Changes to this policy</h2>
					<p>We may update this policy. If we make significant changes, we'll notify users in the app or by email.</p>
				</section>

				<section id="contact">
					<h2>14. Contact us</h2>
					<p>
						Chesserly<br>
						<a href="mailto:chesserlyapp@gmail.com">chesserlyapp@gmail.com</a>
					</p>
				</section>
			</main>
		</div>
	</div>
</template>

<style scoped>
	.page-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.75rem;
		padding: clamp(0.5rem, 2vw, 1rem);
		box-sizing: border-box;
	}

	@media (min-width: 768px) {
		.page-layout {
			grid-template-columns: auto minmax(0, 1fr);
			gap: 1.25rem;
			align-items: start;
		}
	}

	.privacy {
		--ink: #f4f0e3;
		--muted: rgba(244, 240, 227, 0.5);
		--line: rgba(255, 255, 255, 0.1);
		--accent: #d9b382;
		--surface: rgba(0, 0, 0, 0.25);
		--square-a: #5a6b3d;
		--square-b: #3a4528;
		--mark-bg: #4a3d12;
		--mark-text: #ffe9a0;
		--serif: Charter, "Iowan Old Style", Georgia, serif;
		--sans: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;

		width: 100%;
		max-width: 52rem;
		margin: 0 auto;
		min-width: 0;
		border-radius: 14px;
		border: 1px solid var(--line);
		background: linear-gradient(145deg, var(--panel-1, #262421), var(--panel-2, #1e1c18));
		box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
		overflow: hidden;
		color: var(--ink);
		font-family: var(--serif);
		font-size: 1.0625rem;
		line-height: 1.7;
	}

	.board-strip {
		height: 24px;
		background-color: var(--square-b);
		background-image:
			linear-gradient(45deg, var(--square-a) 25%, transparent 25%, transparent 75%, var(--square-a) 75%),
			linear-gradient(45deg, var(--square-a) 25%, transparent 25%, transparent 75%, var(--square-a) 75%);
		background-size: 48px 48px;
		background-position: 0 0, 24px 24px;
	}

	.wrap {
		padding: 0 1.5rem;
	}

	.site-header {
		padding: 2rem 0 1.25rem;
		border-bottom: 1px solid var(--line);
	}

	h1 {
		font-family: var(--sans);
		font-size: clamp(1.8rem, 5vw, 2.5rem);
		line-height: 1.15;
		letter-spacing: -0.02em;
		margin: 0 0 0.5rem;
	}

	.updated {
		margin: 0;
		color: var(--muted);
		font-family: var(--sans);
		font-size: 0.9rem;
	}

	.intro {
		font-size: 1.1rem;
		margin: 2rem 0 0;
	}

	main {
		padding-bottom: 2.5rem;
	}

	section {
		margin-top: 2.5rem;
		scroll-margin-top: 1rem;
	}

	h2 {
		font-family: var(--sans);
		font-size: 1.25rem;
		line-height: 1.3;
		margin: 0 0 0.75rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--line);
	}

	p {
		margin: 0 0 1rem;
		max-width: 68ch;
	}

	ul {
		margin: 0 0 1rem;
		padding-left: 1.25rem;
		max-width: 68ch;
	}

	li {
		margin-bottom: 0.5rem;
	}

	li::marker {
		color: var(--accent);
	}

	strong {
		font-family: var(--sans);
		font-weight: 650;
		font-size: 0.95em;
	}

	a {
		color: var(--accent);
		text-underline-offset: 0.2em;
	}

	a:hover {
		text-decoration-thickness: 2px;
	}

	a:focus-visible {
		outline: 3px solid var(--accent);
		outline-offset: 3px;
		border-radius: 2px;
	}

	/* Table of contents */
	.toc {
		margin: 2rem 0 0;
		padding: 1.25rem 1.5rem;
		background: var(--surface);
		border-left: 4px solid var(--accent);
		border-radius: 0 6px 6px 0;
		font-family: var(--sans);
		font-size: 0.95rem;
	}

	.toc h2 {
		font-size: 1rem;
		margin: 0 0 0.5rem;
		padding: 0;
		border: 0;
	}

	.toc ol {
		margin: 0;
		padding-left: 1.25rem;
		columns: 2 14rem;
		column-gap: 2rem;
	}

	.toc li {
		margin-bottom: 0.25rem;
		break-inside: avoid;
	}

	/* Highlighted text still to fill in or confirm. Remove the class when done. */
	.fill {
		background: var(--mark-bg);
		color: var(--mark-text);
		padding: 0 0.25em;
		border-radius: 3px;
	}

	@media (max-width: 480px) {
		.privacy {
			font-size: 1rem;
		}
		.wrap {
			padding: 0 1rem;
		}
	}

	@media print {
		.board-strip,
		.toc {
			display: none;
		}
	}
</style>