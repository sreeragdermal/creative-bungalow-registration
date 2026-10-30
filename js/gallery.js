(() => {
  const gallery = document.querySelector(".media-marquee");
  const track = gallery?.querySelector(".media-track");
  if (!gallery || !track) return;

  const mobileTouch = window.matchMedia("(max-width: 900px) and (hover: none) and (pointer: coarse)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (!mobileTouch.matches || !navigator.maxTouchPoints) return;

  const allCards = [...track.querySelectorAll(".media-gallery-card")];
  const originalCards = allCards.filter((card) => !card.classList.contains("media-gallery-duplicate"));
  const duplicateFirst = allCards[originalCards.length];
  if (!originalCards.length || !duplicateFirst) return;
  gallery.classList.add("touch-gallery");

  const autoDelay = 3500;
  let started = false;
  let touchActive = false;
  let currentIndex = 0;
  let advanceTimer = 0;
  let resetTimer = 0;

  function clearTimers() {
    window.clearTimeout(advanceTimer);
    window.clearTimeout(resetTimer);
  }

  function cardLeft(card) {
    return card.getBoundingClientRect().left - gallery.getBoundingClientRect().left + gallery.scrollLeft;
  }

  function nearestOriginalIndex() {
    return originalCards.reduce((nearest, card, index) => {
      const distance = Math.abs(cardLeft(card) - gallery.scrollLeft);
      return distance < nearest.distance ? { index, distance } : nearest;
    }, { index: 0, distance: Infinity }).index;
  }

  function scheduleAdvance(delay = autoDelay) {
    window.clearTimeout(advanceTimer);
    if (!started || touchActive || document.hidden) return;
    advanceTimer = window.setTimeout(advance, delay);
  }

  function jumpToStart() {
    gallery.style.scrollBehavior = "auto";
    gallery.scrollLeft = 0;
    requestAnimationFrame(() => { gallery.style.scrollBehavior = ""; });
    currentIndex = 0;
  }

  function advance() {
    if (!started || touchActive || document.hidden) return;
    if (currentIndex >= originalCards.length - 1) {
      gallery.scrollTo({ left: cardLeft(duplicateFirst), behavior: "smooth" });
      currentIndex = 0;
      resetTimer = window.setTimeout(jumpToStart, 700);
    } else {
      currentIndex += 1;
      gallery.scrollTo({ left: cardLeft(originalCards[currentIndex]), behavior: "smooth" });
    }
    scheduleAdvance(autoDelay);
  }

  gallery.addEventListener("pointerdown", (event) => {
    if (reducedMotion.matches) return;
    if (event.pointerType !== "touch") return;
    touchActive = true;
    clearTimers();
  }, { passive: true });

  gallery.addEventListener("pointerup", (event) => {
    if (reducedMotion.matches) return;
    if (event.pointerType !== "touch") return;
    touchActive = false;
    currentIndex = nearestOriginalIndex();
    started = true;
    scheduleAdvance(2200);
  }, { passive: true });

  gallery.addEventListener("pointercancel", (event) => {
    if (reducedMotion.matches) return;
    if (event.pointerType !== "touch") return;
    touchActive = false;
    currentIndex = nearestOriginalIndex();
    started = true;
    scheduleAdvance(2200);
  }, { passive: true });

  gallery.querySelectorAll(".media-video:not(.media-gallery-duplicate)").forEach((card) => {
    card.addEventListener("click", () => {
      card.classList.add("video-active");
      started = false;
      clearTimers();
    }, { once: true });
  });

  const handleMobileModeChange = () => {
    if (mobileTouch.matches) gallery.classList.add("touch-gallery");
    else {
      clearTimers();
      started = false;
      touchActive = false;
      gallery.classList.remove("touch-gallery");
    }
  };
  if (mobileTouch.addEventListener) mobileTouch.addEventListener("change", handleMobileModeChange);
  else mobileTouch.addListener(handleMobileModeChange);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimers();
    else scheduleAdvance(1000);
  });
})();
