---
title: "Networked Deterministic Array Shuffle in Unreal Engine"
date: "2025-06-13"
description: "This short article shows one way to do a deterministic array shuffle in Unreal Engine."
hideHeader: true
hideBackToTop: true
hidePagination: true
readTime: true
autonumber: true
math: true
tags: ["multiplayer", "ue", "c++"]
showTags: false
---

# Introduction

Sometimes, you want to do a deterministic shuffle of an array for purposes like gacha mechanics, or in my case, replicating the Spin the Wheel minigame in Coral Island!

![Spin the Wheel - Coral Island](/posts/deterministic_shuffle/spin_the_wheel.png "One of festival minigames that players can play in Coral Island")

At the time this feature was developed, it hadn't yet been made to work with multiplayer. Even though Coral Island is a co-op game, not a competitive one, Unreal Engine still adopts a server-authoritative multiplayer model.

The server must always act as the single source of truth.

**Reminder:**  
Unreal Engine uses an authoritative server model for all gameplay state. This ensures that clients never directly control important game logic that could cause desync or cheating.

# What even is deterministic, anyway?

In simple terms, deterministic means that given the same input, you always get the same result.  

That’s exactly what we want in multiplayer: avoid desync between clients and server that can mess up gameplay logic.

# Why do you need this?

One requirement for this minigame was that the order of rewards shown on the UI should be randomized on each play session.

Behind the scenes, the minigame itself is fairly simple: it's just a `TArray` of `GameplayEffect` structs representing the rewards for that festival.

When the Spin button is clicked, the array gets shuffled, and the last index is picked as the reward for that player.

The shuffle happens immediately after clicking, while a UMG spinning animation plays on the wheel. Once the shuffle result is ready, the animation stops at the correct index.

Keep in mind: this article won’t show any Coral Island production code, only a heavily simplified version of it.

# Show me how!

We start by introducing a Seed. A seed is simply an integer that initializes a pRNG (pseudo-Random Number Generator).  
In Unreal Engine, we have `FRandomStream`. You can initialize it like this:

```cpp {linenos=inline hl_lines=[6,"1-10"] style=vim}
int32 Seed = 69420;
const FRandomStream Stream{Seed};
```

# Why do we need to initialize a pRNG with a seed?

The "p" in pRNG stands for pseudo: it's an algorithm that produces a sequence of numbers that appear random, but are fully determined by the initial state, the seed.

This lets us control the randomness, which is crucial for deterministic multiplayer behavior.

Many pRNG libraries will often use system time or entropy sources. Unreal's default randomness calls `rand()`, which may produce different results depending on platform or compiler.

**Note:**  
Internally, `FMath::Rand()` and other default UE random calls often use platform-specific implementations. This can result in different random sequences on different operating systems, CPU architectures, or even compiler versions. `FRandomStream` eliminates this variability entirely by using its own consistent, deterministic implementation.

By using `FRandomStream` and explicitly initializing it, we eliminate this uncertainty.  

The server, regardless of whether it’s running on Steam, Xbox, or PlayStation 5, becomes the source of truth.

The client only needs to receive and handle the result appropriately.

# What about actually shuffling?

Yes, Unreal does have a built-in helper under `Algo::RandomShuffle()`.  
However, as the name implies, it's random and we don't have any control over the generated sequence.

So let’s write our own shuffle, keeping things generic using templates:

```cpp {linenos=inline hl_lines=[6,"1-10"] style=vim}
template <class T>
static void ShuffleArray(T& InArray, const int32 Seed)
{
    const FRandomStream Stream{Seed};
    const int32 LastIndex = InArray.Num() - 1;
    for (int32 I = 0; I < LastIndex; ++I)
    {
        const int32 Index = Stream.RandRange(0, LastIndex);
        if (I == Index) continue;
        
        InArray.Swap(I, Index);
    }
}
```

Simple enough.

This implementation is heavily inspired by a modern version of the Fisher-Yates shuffle, which ensures all permutations are equally likely.  

Consider reading the [Wikipedia article](https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle) for more.

# How do I use it?

The key is: run it only on the server.

For example:

```cpp {linenos=inline hl_lines=[6,"1-10"] style=vim}
UPROPERTY(EditInstanceOnly, Replicated)
TArray<int32> Array = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9};
```

Now let’s test it by printing the result:

```cpp {linenos=inline hl_lines=[6,"1-10"] style=vim}
UE_LOG(LogTemp, Warning, TEXT("Seed: %d"), Seed);

FString ArrayToShuffleString;

for (const int32 Number : Array)
{
    ArrayToShuffleString += FString::FromInt(Number) + ", ";
}

ArrayToShuffleString.RemoveAt(ArrayToShuffleString.Len() - 2);

UE_LOG(LogTemp, Warning, TEXT("Array to shuffle: %s"), *ArrayToShuffleString);

TArray<int32> ArrayToShuffleCopy = Array;

ShuffleArray(ArrayToShuffleCopy, Seed);
ArrayToShuffleString.Empty();

for (const int32 Number : ArrayToShuffleCopy)
{
    ArrayToShuffleString += FString::FromInt(Number) + ", ";
}

ArrayToShuffleString.RemoveAt(ArrayToShuffleString.Len() - 2);

UE_LOG(LogTemp, Warning, TEXT("Shuffled array: %s"), *ArrayToShuffleString);
```

Now, every time you execute this with the same seed, you’ll always get the same shuffled result:

```
Seed: 69
Array to shuffle: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 
Shuffled array: 3, 2, 0, 5, 4, 7, 6, 9, 8, 1 

Seed: 69
Array to shuffle: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 
Shuffled array: 3, 2, 0, 5, 4, 7, 6, 9, 8, 1 

Seed: 24
Array to shuffle: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 
Shuffled array: 1, 0, 6, 7, 9, 2, 3, 8, 5, 4 

Seed: 24
Array to shuffle: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 
Shuffled array: 1, 0, 6, 7, 9, 2, 3, 8, 5, 4 
```

# How do I replicate it?

If you want clients to receive the shuffle result, you have several options:

- Replication (if your data isn’t too large, otherwise consider Fast TArray Replication)
- Multicast RPC (if all clients need to know, but don’t need to store state)
- Client RPC (for fine-grained control targeting specific clients)

In Coral Island, I use the Client RPC approach for this particular mechanic.

**Replication Tip:**  
In general, avoid replicating large shuffled arrays directly if they are big. Fast Array Replication is an excellent option for large structs or reward pools because it reduces bandwidth usage by only replicating changed items. See [Fast TArray Replication](https://ikrima.dev/ue4guide/networking/network-replication/fast-tarray-replication/) for more details.

**RPC Selection Guide:**  
- Use Multicast RPC if all clients need to know and timing isn't critical.  
- Use Client RPC for precision targeting and better control over network conditions.

# That's all folks!

In conclusion: this is one way to achieve deterministic multiplayer behavior by using a pRNG initialized with a seed.

- The server stays as the authoritative source of truth.
- You eliminate randomness inconsistencies across platforms.
- The clients simply receive the shuffled result via replication or RPC.

Thank you for reading - I hope this helps someone who needs to implement a similar mechanic.  
See you next time!