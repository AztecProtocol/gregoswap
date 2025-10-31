mod test;

use aztec::macros::aztec;

#[aztec]
pub contract ProofOfPassword {

    use aztec::{
        keys::getters::get_public_keys,
        macros::{functions::{external, initializer, internal}, storage::storage},
        protocol_types::{
            address::AztecAddress,
            hash::poseidon2_hash,
            traits::{Hash, Serialize, ToField},
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

        let address = storage.grego_coin_address.read();
        Token::at(address).mint_to_private(to, 1000).call(&mut context);

        let msg_sender_nullifier_public_key_message_hash =
            get_public_keys(context.msg_sender().unwrap()).npk_m.hash();

        let secret = context.request_nsk_app(msg_sender_nullifier_public_key_message_hash); // get secret key of caller of function
        let nullifier = poseidon2_hash([context.msg_sender().unwrap().to_field(), secret]); // derive nullifier from sender and secret
        context.push_nullifier(nullifier);
    }
}
