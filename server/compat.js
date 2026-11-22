if (!Promise.withResolvers)
  Promise.withResolvers = function () {
    let resolve, reject
    const promise = new this((a, b) => {
      resolve = a
      reject = b
    })
    return { promise, resolve, reject }
  }
document.documentElement.classList.add('cloud-reader')
