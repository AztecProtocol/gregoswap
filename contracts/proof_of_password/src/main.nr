mod test;

use aztec::macros::aztec;

#[aztec]
pub contract ProofOfPassword {

    use aztec::{
        macros::{functions::{external, initializer, internal}, storage::storage},
        oracle::notes::set_sender_for_tags,
        protocol_types::{
            address::AztecAddress,
            hash::poseidon2_hash,
            traits::{Serialize, ToField},
        },
        state_vars::PublicImmutable,
    };
    use compressed_string::FieldCompressedString;
    use token::Token;

    #[storage]
    struct Storage<Context> {
        grego_coin_address: PublicImmutable<AztecAddress, Context>,
        password_hash: PublicImmutable<Field, Context>,
    }

    #[initializer]
    #[external("private")]
    fn constructor(grego_coin_address: AztecAddress, password: str<31>) {
        let field_compressed_str = FieldCompressedString::from_string(password);
        let password_hash = poseidon2_hash(field_compressed_str.serialize());
        ProofOfPassword::at(context.this_address())
            ._init_storage(grego_coin_address, password_hash)
            .enqueue(&mut context);
    }

    #[external("public")]
    #[internal]
    fn _init_storage(grego_coin_address: AztecAddress, password_hash: Field) {
        storage.grego_coin_address.initialize(grego_coin_address);
        storage.password_hash.initialize(password_hash);
    }

    #[external("private")]
    fn check_password_and_mint(password: str<31>, to: AztecAddress) {
        let field_compressed_str = FieldCompressedString::from_string(password);
        let password_hash = storage.password_hash.read();
        assert(
            poseidon2_hash(field_compressed_str.serialize()) == password_hash,
            f"Invalid password {password}",
        );

        // Safety: PXE will enforce a sender for the tags of the notes created
        // in the Token.mint function, but this one intented to be called by anyone
        // that knows the passord, not necessarily the recipient. Chances are this fn 
        // will be invoked by the MultiCallEntrypoint protocol contract,
        // which does not set a sender for tags.
        // We intend the "to" of this function to claim the notes, so we're just calling
        // the oracle for its sideeffects, making it safe to call
        unsafe {
            set_sender_for_tags(to);
        }

        let address = storage.grego_coin_address.read();
        Token::at(address).mint_to_private(to, 1000).call(&mut context);

        // Derive nullifier from sender and password. This is still a privacy leak, since 
        // knowing the password and an address is sufficient to know if someone has used this
        // contract or not. But at least, they need the password
        let nullifier = poseidon2_hash([to.to_field(), field_compressed_str.serialize()[0]]); 
        context.push_nullifier(nullifier);
    }
}
