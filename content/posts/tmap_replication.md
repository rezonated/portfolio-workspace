---
title: "Approaches to replicate Unreal Engine's TMap"
date: "2025-06-14"
description: "This article shows two approaches to replicate TMap structures in Unreal Engine"
hideHeader: true
hideBackToTop: true
hidePagination: true
readTime: true
autonumber: false
math: true
tags: ["multiplayer", "ue", "c++"]
showTags: false
---

# Introduction

If you ever attempt to put a `Replicated` specifier on your `UPROPERTY` with `TMap`, your IDE or compiler might yell at you like this:

![TMap Replication Attempt](/posts/tmap_replication/tmap_doesnt_support_replication.png "Replication maps are not supported?")

# Why can't TMap be replicated by Unreal?

Unreal's built-in replication only supports certain types that the replication system knows how to serialize. This includes basic primitives, some containers like `TArray`, `FVector`, or custom structs containing `UPROPERTY` fields.

`TMap` is considered a dynamic container because of its non-fixed size, ordering, and hashing behavior. That makes replication much trickier to handle reliably - which is likely why Epic doesn’t provide built-in support for replicating `TMap`.

# So... we can't replicate TMap at all?

Not exactly. While you can't simply slap a `Replicated` specifier onto a `TMap`, there are still ways to replicate map-like data manually. One is relatively straightforward, while the other requires a bit more advanced serialization work.

The two approaches we’ll cover:

1. Replicate a separate array of key-value structs alongside your map.
2. Wrap your `TMap` inside a custom `USTRUCT` and implement `NetSerialize()` for full control over serialization.

# Approach 1 - The separate array approach

The idea here is simple: create a separate replicated `TArray` (which Unreal does support) containing your map’s key-value pairs as custom structs. Then rebuild the `TMap` on the client when the array replicates.

The server holds its own `TMap`, but updates the replicated array to reflect its contents. Clients receive the array and reconstruct their local copy of the map from that.

---

## Step 1 - Define key-value struct

Suppose you want to replicate a `TMap<uint32, float>`. First, define a `USTRUCT` holding the key-value pair:

```cpp {linenos=inline style=vim}
USTRUCT()
struct FUnsignedIntFloatEntry
{
    GENERATED_BODY()

    UPROPERTY()
    uint32 Key = 0;

    UPROPERTY()
    float Value = 0.f;
};
```

---

## Step 2 - Declare replicated array and local map

Now define both your replicated array and the actual map you’ll use internally:

```cpp {linenos=inline style=vim}
UPROPERTY(ReplicatedUsing = OnRep_UnsignedIntFloatArrays)
TArray<FUnsignedIntFloatEntry> UnsignedIntFloatArrays;

UPROPERTY(Transient)
TMap<uint32, float> UniqueIdToFloatMap;
```

---

## Step 3 - Populate your map on the server

Here’s an example where we grab random actors in the world and assign random float values to build the map:

```cpp {linenos=inline style=vim}
if (!HasAuthority()) return;

TArray<AActor*> ActorsInWorld;
UGameplayStatics::GetAllActorsOfClass(this, AActor::StaticClass(), ActorsInWorld);

for (int I = 0; I < 10; ++I)
{
    const int32 RandomIdx = FMath::RandRange(0, ActorsInWorld.Num() - 1);

    const uint32 RandomChosenActorUniqueId = ActorsInWorld[RandomIdx]->GetUniqueID();
    const float RandomFloat = FMath::FRand();
    UniqueIdToFloatMap.Emplace(RandomChosenActorUniqueId, RandomFloat);  
}

const TArray<TPair<uint32, float>>& PairArray = UniqueIdToFloatMap.Array();
for (const TPair<uint32, float>& Pair : PairArray)
{
    FUnsignedIntFloatEntry Entry;
    Entry.Key = Pair.Key;
    Entry.Value = Pair.Value;

    UE_LOG(LogTemp, Warning, TEXT("%s - Key: %d, Value: %f"), *NetModeToString(), Pair.Key, Pair.Value);
    UnsignedIntFloatArrays.Emplace(MoveTemp(Entry));
}
```

The important part: only `UnsignedIntFloatArrays` is replicated. Once it updates, the client receives the notification.

---

## Step 4 - Rebuild the map on client using RepNotify

The client receives the updated array, and reconstructs its own local map:

```cpp {linenos=inline style=vim}
UniqueIdToFloatMap.Reset();

for (const FUnsignedIntFloatEntry& Entry : UnsignedIntFloatArrays)
{
    UE_LOG(LogTemp, Warning, TEXT("%s - Key: %d, Value: %f"), *NetModeToString(), Entry.Key, Entry.Value);
    UniqueIdToFloatMap.Emplace(Entry.Key, Entry.Value);
}
```

---

And that’s it - you’ve successfully replicated a `TMap` manually.

```
Warning LogTemp AddMapEntry
Warning LogTemp ListenServer - Key: 141843, Value: 0.205267
Warning LogTemp ListenServer - Key: 102850, Value: 0.510819
Warning LogTemp ListenServer - Key: 141885, Value: 0.806024
Warning LogTemp ListenServer - Key: 141881, Value: 0.757683
Warning LogTemp ListenServer - Key: 102854, Value: 0.755730
Warning LogTemp ListenServer - Key: 103198, Value: 0.526231
Warning LogTemp ListenServer - Key: 141865, Value: 0.435102
Warning LogTemp ListenServer - Key: 141839, Value: 0.839351
Warning LogTemp OnRep_UnsignedIntFloatArrays
Warning LogTemp Client - Key: 141843, Value: 0.205267
Warning LogTemp Client - Key: 102850, Value: 0.510819
Warning LogTemp Client - Key: 141885, Value: 0.806024
Warning LogTemp Client - Key: 141881, Value: 0.757683
Warning LogTemp Client - Key: 102854, Value: 0.755730
Warning LogTemp Client - Key: 103198, Value: 0.526231
Warning LogTemp Client - Key: 141865, Value: 0.435102
Warning LogTemp Client - Key: 141839, Value: 0.839351
```

---

# Approach 2 - Custom NetSerialize

This approach takes a bit more work, but offers far more flexibility and cleaner code.

The idea: wrap your `TMap` inside a custom `USTRUCT`, and override Unreal’s `NetSerialize()` function to manually define how it should serialize across the network.

---

## Step 1 - Declare your wrapper struct

We’ll wrap our `TMap` and disable default replication on it:

```cpp {linenos=inline style=vim}
USTRUCT()
struct FUnsignedIntFloatMapWrapper
{
    GENERATED_BODY()

    UPROPERTY(NotReplicated)
    TMap<uint32, float> WrappedMap;
};
```

> Note: if you forget `NotReplicated`, Unreal’s header tool will still complain about unsupported types!


![Unsupported TMap in Struct](/posts/tmap_replication/unsupported_tmap_in_struct.png)

---

## Step 2 - Tell Unreal to expect NetSerialize()

We now define a type trait to let Unreal know our struct implements custom serialization:

```cpp {linenos=inline style=vim}
template <>
struct TStructOpsTypeTraits<FUnsignedIntFloatMapWrapper> : TStructOpsTypeTraitsBase2<FUnsignedIntFloatMapWrapper>
{
    enum { WithNetSerializer = true };
};
```

> You may see your IDE warn you that `NetSerialize()` is not implemented yet - that's expected.

![Missing NetSerialize() type trait](/posts/tmap_replication/missing_type_traits.png "Which leads us to...")

---

## Step 3 - Implement NetSerialize()

Let’s quickly understand what `FArchive` is.

Unreal uses `FArchive` as a low-level stream abstraction for many systems - including replication, asset cooking, file saves, etc.

Within `NetSerialize()`, we’ll:

- Send the map’s length first.
- Serialize each key-value pair.
- Handle both writing (`IsSaving()`) and reading (`IsLoading()`).

Here’s the full implementation:

```cpp {linenos=inline style=vim}
bool NetSerialize(FArchive& Ar, UPackageMap* Map, bool& bOutSuccess)
{
    int32 MapLength = WrappedMap.Num();
    Ar << MapLength;

    if (Ar.IsLoading())
    {
        WrappedMap.Empty(MapLength);
        for (int I = 0; I < MapLength; ++I)
        {
            uint32 TempKey;
            float TempValue;
            Ar << TempKey;
            Ar << TempValue;
            WrappedMap.Emplace(TempKey, TempValue);
        }
    }
    else if (Ar.IsSaving())
    {
        for (TPair<uint32, float>& Pair : WrappedMap)
        {
            Ar << Pair.Key;
            Ar << Pair.Value;
        }
    }

    bOutSuccess = true;
    return true;
}
```

---

## Step 4 - Use your struct in RPCs

Because it's now fully serializable, you can easily pass it inside RPCs:

```cpp {linenos=inline style=vim}
FUnsignedIntFloatMapWrapper WrappedUnsignedIntFloatMap;

TArray<AActor*> ActorsInWorld;
UGameplayStatics::GetAllActorsOfClass(this, AActor::StaticClass(), ActorsInWorld);

for (int I = 0; I < 10; ++I)
{
    const int32 RandomIdx = FMath::RandRange(0, ActorsInWorld.Num() - 1);
    const uint32 RandomChosenActorUniqueId = ActorsInWorld[RandomIdx]->GetUniqueID();
    const float RandomFloat = FMath::FRand();
    WrappedUnsignedIntFloatMap.WrappedMap.Emplace(RandomChosenActorUniqueId, RandomFloat);
}

Client_UpdateWrappedUnsignedIntFloatMap(WrappedUnsignedIntFloatMap);
```

And that's it!
```
Warning LogTemp Server_UpdateWrappedUnsignedIntFloat_Implementation
Warning LogTemp ListenServer - Key: 102882, Value: 0.963286
Warning LogTemp ListenServer - Key: 103196, Value: 0.561937
Warning LogTemp ListenServer - Key: 141897, Value: 0.334910
Warning LogTemp ListenServer - Key: 103223, Value: 0.789727
Warning LogTemp ListenServer - Key: 141845, Value: 0.871975
Warning LogTemp ListenServer - Key: 102850, Value: 0.330668
Warning LogTemp ListenServer - Key: 103206, Value: 0.947081
Warning LogTemp ListenServer - Key: 141879, Value: 0.844203
Warning LogTemp ListenServer - Key: 141856, Value: 0.412580
Warning LogTemp Client_UpdateWrappedUnsignedIntFloatMap_Implementation
Warning LogTemp Client - Key: 102882, Value: 0.963286
Warning LogTemp Client - Key: 103196, Value: 0.561937
Warning LogTemp Client - Key: 141897, Value: 0.334910
Warning LogTemp Client - Key: 103223, Value: 0.789727
Warning LogTemp Client - Key: 141845, Value: 0.871975
Warning LogTemp Client - Key: 102850, Value: 0.330668
Warning LogTemp Client - Key: 103206, Value: 0.947081
Warning LogTemp Client - Key: 141879, Value: 0.844203
Warning LogTemp Client - Key: 141856, Value: 0.412580
```

---

# Conclusion

While Unreal doesn’t support replicating `TMap` out-of-the-box, you can still work around it depending on your needs:

- The **array approach** is simple, easy to integrate with native replication, and perfectly valid if your map changes infrequently.
- The **NetSerialize() approach** gives you much tighter control, cleaner encapsulation, and allows you to pass entire maps directly inside RPC calls.

Both approaches showcase how flexible Unreal’s replication system can be once you dig into custom serialization.

Whichever you choose depends on your use case - how large your map is, how often it changes, and how much control you need.

Thanks for reading! I hope this helps anyone looking to replicate `TMap`s or just exploring Unreal’s replication internals.

See you next time!